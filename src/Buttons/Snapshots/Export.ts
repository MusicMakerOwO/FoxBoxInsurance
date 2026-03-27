import {COLOR} from "../../Utils/Constants";
import {Database} from "../../Database";
import {ExportSnapshot, GetSnapshot} from "../../CRUD/Snapshots";
import {SnapshotParsers} from "../../Utils/Snapshots/Imports/Parse";
import {ButtonHandler} from "../../Typings/HandlerTypes";
import {JSONReplacer} from "../../JSON";
import {createHash} from "node:crypto";
import {UploadCDN} from "../../Utils/UploadCDN";
import { TOS_FEATURES } from "../../TOSConstants";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes";
import { DiscordPermissions } from "../../Utils/DiscordConstants";

const HASH_ALGORITHM = 'sha256';

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.MANAGE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : false,
	customID      : 'snapshot-export',
	execute       : async function (interaction, client, args) {

		const snapshotID = parseInt(args[0]);
		if (isNaN(snapshotID) || snapshotID < 1) throw new Error(`Invalid snapshot ID provided: ${args[0]}`);

		const snapshot = await GetSnapshot(snapshotID);
		if (!snapshot) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'Snapshot Not Found',
					description: `Snapshot not found or already deleted\nCreate one using \`/snapshot create\``
				}]
			}
		}

		const data = await ExportSnapshot(snapshotID);
		if (!SnapshotParsers[data.version]) {
			// sanity check, should never happen
			throw new Error(`No parse function registered for snapshot version ${data.version}`);
		}

		const serializedData = JSON.stringify(data, JSONReplacer);

		const hash = createHash(HASH_ALGORITHM).update(serializedData).digest('hex');

		const fileName = 'snapshot-' + snapshotID;

		void Database.query(`
			INSERT INTO SnapshotExports (
				id,
				snapshot_id, guild_id, user_id,
				version, length,
				hash, algorithm
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, [
			data.id,
			snapshotID,
			BigInt(interaction.guildId!),
			BigInt(interaction.user.id),
			data.version,
			serializedData.length,
			hash,
			HASH_ALGORITHM
		]);

		const lookup = await UploadCDN(fileName, 'json', Buffer.from(serializedData, 'utf8'), 1); // 1 url = 1 download

		return {
			embeds: [{
				color: COLOR.PRIMARY,
				description: `
**Download Link:** [Click here to download](https://cdn.notfbi.dev/download/${lookup})
**File Size:** ${(serializedData.length / 1024).toFixed(2)} KB
**Export ID:** ${data.id}`
			}],
			components: [{
				type: 1,
				components: [{
					type: 2,
					style: 5,
					label: 'Download',
					url: `https://cdn.notfbi.dev/download/${lookup}`,
					emoji: { name: '📥' }
				}]
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;