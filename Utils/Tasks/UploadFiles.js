const Database = require("../Database");
const fs = require("node:fs");
const { UPLOAD_CACHE } = require("../Constants");
const Logs = require("../Logs");
const UploadCDN = require("../UploadCDN");

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
		const asset = await connection.query(`SELECT asset_id FROM Assets WHERE discord_id = ? AND uploaded = 1`, [discordID]).then(res => res[0]);
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