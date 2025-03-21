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

const ASSET_FOLDERS = {
	[ASSET_TYPE.GUILD]: CONSTANTS.GUILD_ICONS_FOLDER,
	[ASSET_TYPE.USER]: CONSTANTS.USER_ICONS_FOLDER,
	[ASSET_TYPE.EMOJI]: CONSTANTS.EMOJI_FOLDER,
	[ASSET_TYPE.STICKER]: CONSTANTS.STICKER_FOLDER,
	[ASSET_TYPE.ATTACHMENT]: CONSTANTS.ATTACHMENTS_FOLDER
}

for (const table of Object.values(ASSET_TABLES)) {
	if (!(table in Database.tables)) throw new Error(`Table ${table} does not exist in the database`);
}

for (const asset_folder of Object.values(ASSET_FOLDERS)) {
	if (!fs.existsSync(asset_folder)) fs.mkdirSync(asset_folder, { recursive: true });
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
	INSERT INTO Assets (discord_id, url, hash, extension, folder, width, height, size)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	
	-- Already exists, update in place, no need for a delete
	ON CONFLICT(discord_id) DO UPDATE SET
		url = excluded.url,
		hash = excluded.hash,
		extension = excluded.extension,
		folder = excluded.folder,
		width = excluded.width,
		height = excluded.height,
		size = excluded.size
`);

async function DownloadAssets() {

	if (DownloadQueue.length === 0) return;

	// copy the queue to a local variable and clear the public one
	const queue = DownloadQueue.slice();
	DownloadQueue.length = 0;

	CurrentURLs.clear();

	Log.debug(`Downloading ${queue.length} assets`);

	let cacheHit = 0;

	const start = Date.now();
	for (const asset of queue) {
		// assume duplicate asset, each url *should* be unique unless I am forgetting something 
		if (RecentURLs.has(asset.url)) {
			cacheHit++;
			continue;
		}

		const folder = ASSET_FOLDERS[asset.type];
		
		const extension = asset.url.match(REGEX_EXTENSION).pop().slice(1) || 'png';

		const buffer = await DownloadURL(asset.url).catch((err) => {
			Log.error(err);
			return null;
		});
		if (!buffer) continue;

		const hash = crypto.createHash('sha1').update(buffer).digest('hex');

		// Check if the file already exists - This is the disk de-duplication
		const filePath = `${folder}/${hash}.${extension}`;

		try {
			await fs.promises.writeFile(filePath, buffer, { flag: 'wx' });
		} catch (err) {
			if (err.code !== 'EEXIST') throw err;
			// file already exists, do nothing
		}

		InsertAssets.run(
			asset.id,
			asset.url,
			hash,
			extension,
			folder,
			asset.width,
			asset.height,
			buffer.length
		);
	}

	const end = Date.now();

	Log.debug(`Downloaded ${queue.length} assets in ${end - start}ms - ${cacheHit}/${queue.length} cache hits`);

	if (RecentURLs.size > MAX_URL_CACHE_SIZE) {
		let urlsToRemove = RecentURLs.size - MAX_URL_CACHE_SIZE;
		for (const url of RecentURLs) {
			RecentURLs.delete(url);
			if (--urlsToRemove <= 0) break;
		}
	}
	
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

module.exports.ASSET_TYPE = ASSET_TYPE;
module.exports.ASSET_FOLDERS = ASSET_FOLDERS;
module.exports.DownloadQueue = DownloadQueue;
module.exports.DownloadAssets = DownloadAssets; // public access

Task.schedule(DownloadAssets, 1000 * 60); // every 60 seconds
