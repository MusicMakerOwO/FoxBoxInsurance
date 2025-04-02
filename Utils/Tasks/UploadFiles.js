const Database = require("../Database");
const https = require("node:https");
const fs = require("node:fs");
const { UPLOAD_CACHE } = require("../Constants");
const Logs = require("../Logs");
const TaskScheduler = require("../TaskScheduler");

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

module.exports = async function UploadAssets() {
	const UploadList = Database.prepare(`SELECT * FROM Assets WHERE uploaded = 0`).all();
	if (UploadList.length === 0) {
		Logs.success('No assets to upload');
		return;
	}

	Logs.success(`Uploading ${UploadList.length} assets...`);

	const start = Date.now();

	const failedFiles = new Set();

	for (const asset of UploadList) {
		const filePath = `${UPLOAD_CACHE}/${asset.discord_id}.${asset.extension}`;
		if (!fs.existsSync(filePath)) {
			// something went wrong, we know the asset exists but we dont have the data
			// Best we can do is delete the asset and hope like hell it will be downloaded again in the future
			Database.prepare(`DELETE FROM Assets WHERE asset_id = ?`).run(asset.asset_id);
			continue;
		}

		const data = await fs.promises.readFile(filePath);
		// console.log(data.length, HUNDRED_MEGABYTES, data.length > HUNDRED_MEGABYTES);

		try {
			var hash = await Upload(asset.name, asset.extension, data);
		} catch (error) {
			Logs.error(`Failed to upload ${asset.discord_id}.${asset.extension}: ${error}`);
			failedFiles.add(`${asset.discord_id}.${asset.extension}`);
			continue;
		}

		Database.prepare(`UPDATE Assets SET uploaded = 1, hash = ? WHERE asset_id = ?`).run(hash, asset.asset_id);

		// delete the file after uploading
		await fs.promises.unlink(filePath);
	}

	// CHeck for orphaned files
	const files = fs.readdirSync(UPLOAD_CACHE);
	if (files.length > 0) {
		for (const file of files) {
			if (failedFiles.has(file)) continue;
			Logs.error(`Orphaned file found: ${file}`);
		}
	}

	const end = Date.now();
	const duration = end - start;
	Logs.success(`Uploaded ${UploadList.length - failedFiles.size}/${UploadList.length} assets in ${duration}ms`);
}

async function Upload(name, extension, data) {
	// POST cdn.notfbi.dev/upload
	return new Promise((resolve, reject) => {
		const request = https.request({
			hostname: 'cdn.notfbi.dev',
			port: 443,
			path: '/upload',
			method: 'POST',
			headers: {
				'Content-Type': 'application/octet-stream',
				'Content-Length': data.length,
				'name': name,
				'ext': extension,
				'key': process.env.ACCESS_KEY
			}
		}, (response) => {
			const data = [];
			response.on('data', chunk => data.push(chunk));
			response.on('end', () => {
				switch (response.statusCode) {
					case 200:
					case 201:
						// Uploaded successfully, returned a hash to use for retrieval
						resolve( data.join('') );
						break;
					case 401: reject('Invalid key provided'); break;
					case 413: reject('File is too large'); break;
					default: reject(`Unknown error (${response.statusCode})`); break;
				}
			});
		});

		function OnError() {
			reject('Failed to upload asset');
			request.destroy();
		}

		request.on('error', OnError);
		request.on('timeout', OnError);

		request.write(data);
		request.end();
	});
}