const fs = require("node:fs");
const https = require("node:https");

const CONSTANTS = require("../Constants");
const Database = require("../Database");
const Log = require("../Logs");

const Task = require("../TaskScheduler");
const TestConnection = require("../TestConnection");

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
	if (!Database.tables.has(table)) throw new Error(`Table ${table} does not exist in the database`);
}

const HUNDRED_MEGABYTES = 1024 * 1024 * 100;

const BasicAsset = {
	id: '',
	name: '',
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
const RecentURLs = new Set( Database.prepare("SELECT discord_url FROM Assets ORDER BY asset_id DESC LIMIT ?").pluck().all(MAX_URL_CACHE_SIZE) );

const REGEX_EXTENSION = /\.(\w+)/g;

/*
CREATE TABLE IF NOT EXISTS Assets (
	asset_id INTEGER PRIMARY KEY AUTOINCREMENT,
	discord_id TEXT NOT NULL, -- Discord ID of whatever this asset represents
	type INTEGER NOT NULL,

	-- The URL to the asset on Discord's servers, may return 404 if they delete it
	-- For long term retrievale use the cdn server and lookup by hash
	discord_url TEXT NOT NULL UNIQUE,

	name TEXT NOT NULL, -- Original file name
	extension TEXT NOT NULL,
	fileName TEXT GENERATED ALWAYS AS (name || '.' || extension) VIRTUAL, -- The file name of the asset

	width INTEGER,
	height INTEGER,
	size INTEGER, -- in bytes

	hash TEXT, -- this will be set after uploading to the cdn server
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime')),
	uploaded INTEGER NOT NULL DEFAULT 0 -- 1 if the file is uploaded to the storage
) STRICT;
*/
const InsertAssets = Database.prepare(`
	INSERT INTO Assets (type, discord_id, discord_url, name, extension, width, height, size)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?)

	-- Already exists, update in place, no need for a delete
	ON CONFLICT(discord_id) DO UPDATE SET
		type = excluded.type,
		discord_id = excluded.discord_id,
		discord_url = excluded.discord_url,
		name = excluded.name,
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

	const start = Date.now();
	for (const asset of queue) {
		// assume duplicate asset, each url *should* be unique unless I am forgetting something 
		if (RecentURLs.has(asset.url)) {
			cacheHit++;
			continue;
		}
		RecentURLs.add(asset.url);

		if (noInternet) {
			// if we already had a failure, stop trying to download
			failedDownloads.push(asset);
			Log.warn(`Skipping download due to previous failure : ${asset.url}`);
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
			}
			continue;
		}

		// write to disk for later upload
		await fs.promises.writeFile(`${CONSTANTS.UPLOAD_CACHE}/${asset.id}.${extension}`, buffer);

		if (asset.url.startsWith('https://cdn.discordapp.com/embed/avatars/')) {
			asset.url = `fbi-internal://default/${asset.id}.${extension}`;
			console.log(`Setting default avatar for ${asset.id} : ${asset.url}`);
		}

		try {
			InsertAssets.run(
				asset.type,
				asset.id,
				asset.url,
				Clean(asset.name),
				extension,
				asset.width,
				asset.height,
				buffer.length
			);
		} catch (err) {
			Log.error(`Failed to insert asset into database: ${err.message}`);
			Log.error(asset);
		}
	}

	const end = Date.now();
	const duration = end - start;

	if (failedDownloads.length > 0) {
		// write them to disk for later retry
		fs.writeFileSync(`${CONSTANTS.DOWNLOAD_CACHE}/${Date.now()}.json`, JSON.stringify(failedDownloads, null, 2));
	}

	Log.debug(`Downloaded ${queue.length} assets in ${duration}ms - ${cacheHit}/${queue.length} cache hits`);

	if (RecentURLs.size > MAX_URL_CACHE_SIZE) {
		let urlsToRemove = RecentURLs.size - MAX_URL_CACHE_SIZE;
		for (const url of RecentURLs) {
			RecentURLs.delete(url);
			if (--urlsToRemove <= 0) break;
		}
	}
}

function Clean(input) {
	if (typeof input !== 'string') throw new TypeError(`Input must be a string : Received ${typeof input}`);
	// remove all non-ASCII characters
	return input.replace(/[^\x20-\x7E]/g, '');
}

async function DownloadURL(url) {
	return new Promise((resolve, reject) => {
		https.get(url, {
			timeout: 5000,
			headers: {
				'Content-Type': 'application/octet-stream'
			}
		},(response) => {
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

module.exports.ASSET_TYPE = ASSET_TYPE;
module.exports.DownloadQueue = DownloadQueue;
module.exports.DownloadAssets = DownloadAssets; // public access

Task.schedule(DownloadAssets, 5000, 1000 * 60); // every 60 seconds