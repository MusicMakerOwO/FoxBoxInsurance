import { existsSync } from "node:fs";
import { Asset } from "../../Typings/DatabaseTypes";
import { Log } from "../Log";
import { readFile, rm } from "node:fs/promises";
import { Database } from "../../Database";
import { UPLOAD_CACHE_PATH } from "../Constants";
import { UploadCDN } from "../UploadCDN";

export async function UploadFiles() {
	const pendingUploads = await Database.query('SELECT * FROM Assets WHERE hash IS NULL') as Asset[];
	Log('TRACE', `Uploading ${pendingUploads.length} files to the CDN`);

	const assetLookups = new Map<Asset['discord_id'], string>();
	for (const asset of pendingUploads) {
		// should never happen but here for completeness
		if (!existsSync(`${UPLOAD_CACHE_PATH}/${asset.discord_id}`)) {
			Log('ERROR', `Could not find file on disk: ${asset.discord_id}`);
			continue;
		}

		try {
			const fileData = await readFile(`${UPLOAD_CACHE_PATH}/${asset.discord_id}`);
			const lookup = await UploadCDN(asset.name, fileData, null) as string;
			assetLookups.set(asset.discord_id, lookup);
		} catch (error) {
			Log('ERROR', error);
		}
	}

	await Database.batch(`
        UPDATE Assets
        SET hash = ?
        WHERE discord_id = ?
	`, Array.from(assetLookups.entries()).map(
		([id, hash]) => ([hash, id])
	));

	for (const discord_id of assetLookups.keys()) {
		void rm(`${UPLOAD_CACHE_PATH}/${discord_id}`)
	}

	Log('TRACE', `Successfully uploaded ${assetLookups.size} / ${pendingUploads.length} files`);
}