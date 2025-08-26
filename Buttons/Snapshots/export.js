const { COLOR, RandomLoadingEmbed } = require("../../Utils/Constants");
const Database = require("../../Utils/Database");
const { ExportSnapshot } = require("../../Utils/SnapshotUtils");
const crypto = require('node:crypto');
const UploadCDN = require("../../Utils/UploadCDN");
const { ParseFunctions } = require("../../Utils/SnapshotImport/ParseFunctions");

const NoSnapshotEmbed = {
	color: COLOR.ERROR,
	title: 'Snapshot Not Found',
	description: `Snapshot not found or already deleted\nCreate one using \`/snapshot create\``
}

const HASH_ALGORITHM = 'sha256';

const NoPermissionEmbed = {
	color: COLOR.ERROR,
	title: 'Missing Permissions',
	description: 'You must be a server administrator for this'
}

module.exports = {
	customID: 'snapshot-export',
	execute: async function (interaction, client, args) {

		if (!interaction.member.permissions.has('Administrator')) {
			return interaction.editReply({
				embeds: [NoPermissionEmbed],
				components: []
			});
		}

		const snapshotID = parseInt(args[0]);
		if (isNaN(snapshotID) || snapshotID < 1) throw new Error(`Invalid snapshot ID provided: ${args[0]}`);

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		await interaction.editReply({
			embeds: [ RandomLoadingEmbed() ],
			components: []
		});

		await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate some delay for loading, purely cosmetic lol

		const [exists] = await Database.query(`
			SELECT id
			FROM Snapshots
			WHERE id = ?
			AND guild_id = ?
		`, [snapshotID, interaction.guild.id]);
		if (!exists) {
			return interaction.editReply({
				embeds: [NoSnapshotEmbed]
			});
		}

		const data = await ExportSnapshot(snapshotID, interaction.guild.id);
		if (!ParseFunctions.has(data.version)) {
			// sanity check, should never happen
			throw new Error(`No parse function registered for snapshot version ${data.version}`);
		}

		function JSONReplacer(key, value) {
			return (typeof value === 'bigint') ? value.toString() + 'n' : value;
		}

		const serializedData = JSON.stringify(data, JSONReplacer);

		const hash = crypto.createHash(HASH_ALGORITHM).update(serializedData).digest('hex');

		const fileName = 'snapshot-' + snapshotID;

		Database.query(`
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
			interaction.guild.id,
			interaction.user.id,
			data.version,
			serializedData.length,
			hash,
			HASH_ALGORITHM
		]);

		const lookup = await UploadCDN(fileName, 'json', Buffer.from(serializedData, 'utf8'), 1); // 1 url = 1 download

		const downloadButton = {
			type: 1,
			components: [{
				type: 2,
				style: 5,
				label: 'Download',
				url: `https://cdn.notfbi.dev/download/${lookup}`,
				emoji: '📥'
			}]
		};

		interaction.editReply({
			embeds: [{
				color: COLOR.PRIMARY,
				description: `
**Download Link:** [Click here to download](https://cdn.notfbi.dev/download/${lookup})
**File Size:** ${(serializedData.length / 1024).toFixed(2)} KB
**Export ID:** ${data.id}`
			}],
			components: [downloadButton]
		});
	}
}