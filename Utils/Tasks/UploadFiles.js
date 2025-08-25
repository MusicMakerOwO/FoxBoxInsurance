const Database = require("../Database");
const fs = require("node:fs");
const { UPLOAD_CACHE } = require("../Constants");
const Logs = require("../Logs");
const UploadCDN = require("../UploadCDN");

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
	const UploadList = await Database.query(`SELECT * FROM Assets WHERE uploaded = 0`);
	if (UploadList.length === 0) {
		Logs.success('No assets to upload');
		return;
	}

	Logs.success(`Uploading ${UploadList.length} assets...`);

	const connection = await Database.getConnection();
	const promiseQueue = [];

	const start = Date.now();

	const failedFiles = new Set();

	for (const asset of UploadList) {
		const filePath = `${UPLOAD_CACHE}/${asset.discord_id}.${asset.extension}`;
		if (!fs.existsSync(filePath)) {
			// something went wrong, we know the asset exists but we dont have the data
			// Best we can do is delete the asset and hope like hell it will be downloaded again in the future
			Logs.error(`File not found: ${filePath}`);
			promiseQueue.push( connection.query(`DELETE FROM Assets WHERE asset_id = ?`, [asset.asset_id]) );
			continue;
		}

		const data = await fs.promises.readFile(filePath);
		// console.log(data.length, HUNDRED_MEGABYTES, data.length > HUNDRED_MEGABYTES);

		try {
			var hash = await UploadCDN(asset.name, asset.extension, data);
		} catch (error) {
			Logs.error(`Failed to upload ${asset.discord_id}.${asset.extension}: ${error}`);
			failedFiles.add(`${asset.discord_id}.${asset.extension}`);
			continue;
		}

		promiseQueue.push( connection.query(`UPDATE Assets SET uploaded = 1, hash = ? WHERE asset_id = ?`, [hash, asset.asset_id]) );

		// delete the file after uploading
		await fs.promises.unlink(filePath);
	}

	// Check for orphaned files
	const files = fs.readdirSync(UPLOAD_CACHE);
	for (const file of files) {
		if (failedFiles.has(file)) continue;
		// check if it was already uploaded
		const discordID = file.split('.')[0];
		const asset = (await connection.query(`SELECT asset_id FROM Assets WHERE discord_id = ? AND uploaded = 1`, [discordID]))[0];
		if (asset) {
			// if it was uploaded but not deleted for whatever reason, delete the file
			Logs.warn(`Oprphaned file not deleted: ${file}`);
			await fs.promises.unlink(`${UPLOAD_CACHE}/${file}`);
			continue;
		}
		Logs.error(`Orphaned file found: ${file}`);
	}

	await Promise.all(promiseQueue);
	Database.releaseConnection(connection);

	const end = Date.now();
	const duration = end - start;
	Logs.success(`Uploaded ${UploadList.length - failedFiles.size}/${UploadList.length} assets in ${duration}ms`);
}