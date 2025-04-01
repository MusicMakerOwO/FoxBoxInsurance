const fs = require("node:fs");
const https = require("node:https");
const crypto = require("node:crypto");

const CONSTANTS = require("../Constants");
const Database = require("../Database");
const Log = require("../Logs");

const Task = require("../TaskScheduler");

const ASSET_TYPE = {
	GUILD: 0,
	USER: 1,
	EMOJI: 2,
	STICKER: 3,
	ATTACHMENT: 4
}

const ASSET_TABLES = {
	[ASSET_TYPE.GUILD]: 'Guilds',
	[ASSET_TYPE.USER]: 'Users',
	[ASSET_TYPE.EMOJI]: 'Emojis',
	[ASSET_TYPE.STICKER]: 'Stickers',
	[ASSET_TYPE.ATTACHMENT]: 'Attachments'
}

for (const table of Object.values(ASSET_TABLES)) {
	if (!(table in Database.tables)) throw new Error(`Table ${table} does not exist in the database`);
}

const HUNDRED_MEGABYTES = 1024 * 1024 * 100;

const BasicAsset = {
	id: '',
	url: '',
	type: ASSET_TYPE.USER,

	// optional
	width: -1,
	height: -1
}

const DownloadQueue = [BasicAsset]; // public access queue
DownloadQueue.length = 0;

const CurrentURLs = new Set(); // List of urls in the queue
const Push = Array.prototype.push.bind(DownloadQueue);
DownloadQueue.push = function (asset = BasicAsset) {
	// Dont add the same URL to the queue
	if (CurrentURLs.has(asset.url)) return;
	CurrentURLs.add(asset.url);
	Push(asset);
}

const MAX_URL_CACHE_SIZE = 1000;
const RecentURLs = new Set( Database.prepare("SELECT url FROM Assets ORDER BY asset_id DESC LIMIT ?").pluck().all(MAX_URL_CACHE_SIZE) );

const REGEX_EXTENSION = /\.(\w+)/g;

const InsertAssets = Database.prepare(`
	INSERT INTO Assets (type, discord_id, url, hash, extension, width, height, size)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	
	-- Already exists, update in place, no need for a delete
	ON CONFLICT(discord_id) DO UPDATE SET
		type = excluded.type,
		discord_id = excluded.discord_id,
		url = excluded.url,
		hash = excluded.hash,
		extension = excluded.extension,
		width = excluded.width,
		height = excluded.height,
		size = excluded.size
`);

function LoadFailedDownloads() {
	const failedAssets = [];

	const cacheFiles = fs.readdirSync(CONSTANTS.DOWNLOAD_CACHE).filter(file => file.endsWith('.json'));
	for (const file of cacheFiles) {
		const filePath = `${CONSTANTS.DOWNLOAD_CACHE}/${file}`;
		try {
			const contents = fs.readFileSync(filePath, 'utf-8');
			const data = JSON.parse(contents);
			if (!Array.isArray(data)) {
				Log.error(`Invalid cache file format: ${file}`);
				continue;
			}

			if (data.length === 0) {
				fs.unlinkSync(filePath); // delete empty cache file
				continue;
			}

			Log.debug(`Retrying failed downloads from cache: ${file}`);
			failedAssets.push(...data); // add failed downloads back to the queue
			fs.unlinkSync(filePath); // delete the cache file after re-adding to queue
		} catch (err) {
			Log.error(err);
		}
	}

	return failedAssets;
}

async function DownloadAssets() {

	// check the download cache folder for failed downloads
	const failedAssets = LoadFailedDownloads();
	for (const asset of failedAssets) {
		DownloadQueue.push(asset);
	}

	if (DownloadQueue.length === 0) return;

	// copy the queue to a local variable and clear the public one
	const queue = DownloadQueue.slice();
	DownloadQueue.length = 0;

	CurrentURLs.clear();

	Log.debug(`Downloading ${queue.length} assets`);

	let cacheHit = 0;

	const failedDownloads = [];
	let noInternet = await TestConnection() === false;
	if (noInternet) {
		Log.error(`No internet connection, cannot download assets`);
	}

	const uploadQueue = []; // { name, extension, data }[]

	const start = Date.now();
	for (const asset of queue) {
		// assume duplicate asset, each url *should* be unique unless I am forgetting something 
		if (RecentURLs.has(asset.url)) {
			cacheHit++;
			continue;
		}

		if (noInternet) {
			// if we already had a failure, stop trying to download
			failedDownloads.push(asset);
			Log.warn(`Skipping download for ${asset.url} due to previous failure`);
			continue;
		}
		
		const extension = asset.url.match(REGEX_EXTENSION).pop().slice(1) || 'png';

		const buffer = await DownloadURL(asset.url).catch((err) => {
			Log.error(err);
			return null;
		});
		if (buffer === null) {
			const connected = await TestConnection();
			if (!connected) {
				noInternet = true;
				Log.error(`No internet connection, stopping downloads`);
				failedDownloads.push(asset);
				continue;
			}
		}

		const hash = crypto.createHash('sha1').update(buffer).digest('hex');

		uploadQueue.push({
			name: hash,
			extension: extension,
			data: buffer
		});

		InsertAssets.run(
			asset.type,
			asset.id,
			asset.url,
			hash,
			extension,
			asset.width,
			asset.height,
			buffer.length
		);
	}

	const end = Date.now();
	const duration = end - start;

	if (failedDownloads.length > 0) {
		Log.error(`Failed to download ${failedDownloads.length} assets:`);
		// write them to disk for later retry
		fs.writeFileSync(`${CONSTANTS.DOWNLOAD_CACHE}/${Date.now()}.json`, JSON.stringify(failedDownloads, null, 2));
	}

	Log.debug(`Downloaded ${queue.length} assets in ${end - start}ms - ${cacheHit}/${queue.length} cache hits`);

	if (RecentURLs.size > MAX_URL_CACHE_SIZE) {
		let urlsToRemove = RecentURLs.size - MAX_URL_CACHE_SIZE;
		for (const url of RecentURLs) {
			RecentURLs.delete(url);
			if (--urlsToRemove <= 0) break;
		}
	}

	// Upload the files to the cdn server
	// cdn.notdbi.dev
	// { name, extenstion, data }
	for (const { name, extension, data } of uploadQueue) {
		try {
			await UploadAsset(name, extension, data);
		} catch (err) {
			Log.error(err);
		}
	}

}


async function UploadAsset(name, extension, data) {
	const header = {
		'Content-Type': 'application/octet-stream',
		'key': process.env.ACCESS_KEY,
		'name': name,
		'ext': extension
	}

	return new Promise((resolve, reject) => {
		const request = https.request('https://cdn.notfbi.dev/upload', {
			method: 'POST',
			headers: header
		}, (response) => {

			let error = '';

			switch (response.statusCode) {
				case 200:
					Log.debug(`Uploaded asset: ${name}.${extension}`);
					resolve();
					return;
				case 401:
					error = 'Invalid access key provided';
					break;
				case 409:
					error = 'Asset already exists';
					break;
				case 413:
					error = 'File too large';
					break;
				default:
					error = `Unknown error (${response.statusCode})`;
					break;
			}

			// if we get here, there was an error lol
			if (error) {
				reject( new Error(error) );
			}
		});

		request.on('error', reject);
		request.on('timeout', reject);

		request.write(data);
		request.end();
	});
}

async function DownloadURL(url) {
	return new Promise((resolve, reject) => {
		https.get(url, (response) => {
			if (response.statusCode !== 200) {
				reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
				return;
			}

			const data = [];
			let size = 0;
			response.on('data', (chunk) => {
				size += chunk.length;
				if (size > HUNDRED_MEGABYTES) {
					reject(new Error(`File too large: ${url}`));
					return;
				}
				data.push(chunk);
			});
			response.on('error', reject);

			response.on('end', () => {
				if (data.length === 0) {
					reject(new Error(`Empty response from '${url}'`));
					return;
				}
				if (response.statusCode !== 200) {
					reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
					return;
				}
				const buffer = Buffer.concat(data);
				resolve(buffer);
			});
		});
	});
}

let connected = false;
let lastTest = 0;

async function TestConnection() {
    if (Date.now() - lastTest < 1000 * 60) return connected;
    return new Promise( resolve => {
        const request = https.get({
            hostname: 'www.google.com',
            port: 443,
            path: '/',
            method: 'HEAD', // only fetches headers, ignore the rest of the webpage
            timeout: 5000
        }, function(response) {
            lastTest = Date.now();
            connected = response.statusCode === 200;
            resolve(connected);
        });
        function onError() {
            lastTest = Date.now();
            connected = false;
            resolve(false);
        }
        request.on('error', onError);
        request.on('timeout', onError);
        request.end();
    });
}

module.exports.ASSET_TYPE = ASSET_TYPE;
module.exports.ASSET_FOLDERS = ASSET_FOLDERS;
module.exports.DownloadQueue = DownloadQueue;
module.exports.DownloadAssets = DownloadAssets; // public access

Task.schedule(DownloadAssets, 5000, 1000 * 60); // every 60 seconds
