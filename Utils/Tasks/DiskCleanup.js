const Database = require("../Database");
const ReadFolder = require("../ReadFolder");
const Log = require("../Logs");
const fs = require("node:fs");
const { ASSET_FOLDERS } = require("../Processing/Images");
const { resolve } = require("node:path");
const { ASSETS_FOLDER } = require("../Constants");

const DatabaseFiles = Database.prepare("SELECT type, fileName, asset_id AS id FROM Assets");
const DeleteAsset = Database.prepare("DELETE FROM Assets WHERE asset_id = ?");

function AssetFullPath(asset) {
	return resolve(ASSET_FOLDERS[asset.type] + '/' + asset.fileName);
}

module.exports = async function DiskCleanup() {
	const start = process.hrtime.bigint();

	const dbAssets = DatabaseFiles.all(); // { type, fileName, id }[]
	const dbIDLookup = Object.fromEntries(dbAssets.map(asset => [AssetFullPath(asset), asset.id])); // fullpath -> asset_id

	// Sets instead of arrays for faster lookup - beats looping all elements lol
	const assetFiles = new Set( dbAssets.map(AssetFullPath) );
	const diskFiles = new Set( ReadFolder(ASSETS_FOLDER).map(p => resolve(p)) );

	let deletedCount = 0;
	let orphanCount = 0;
	
	// Files that are in the disk but not in the database
	// This assumes we have fully de-duped the files and only evicted unused assets
	for (const file of diskFiles) {
		if (!assetFiles.has(file)) {
			fs.unlinkSync(file);
			deletedCount++;
		}
	}

	// Assets that are in the database but not on the disk are marked as orphaned
	// Often this is due to a failed download or a 404 error
	// We can safely delete it as the data is useless, just be careful to check the file exists on export
	for (const asset of assetFiles) {
		if (!diskFiles.has(asset)) {
			DeleteAsset.run( dbIDLookup[asset] );
			orphanCount++;
		}
	}

	const end = process.hrtime.bigint();
	const duration = Number(end - start) / 1e6;

	Log.success(`Disk cleanup took ${duration.toFixed(2)}ms - Deleted ${deletedCount} files and found ${orphanCount} orphaned entries`);
}