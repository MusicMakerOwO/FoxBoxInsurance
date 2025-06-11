const { COLOR, RandomLoadingEmbed } = require("../../Utils/Constants");
const Database = require("../../Utils/Database");
const { ExportSnapshot } = require("../../Utils/SnapshotUtils");
const crypto = require('node:crypto');
const UploadCDN = require("../../Utils/UploadCDN");

const NoSnapshotEmbed = {
	color: COLOR.ERROR,
	title: 'Snapshot Not Found',
	description: `Snapshot not found or already deleted\nCreate one using \`/snapshot create\``
}

const HASH_ALGORITHM = 'sha256';

module.exports = {
	customID: 'snapshot-export',
	execute: async function (interaction, client, args) {
		const snapshotID = parseInt(args[0]);
		if (isNaN(snapshotID) || snapshotID < 1) throw new Error(`Invalid snapshot ID provided: ${args[0]}`);

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		await interaction.editReply({
			embeds: [ RandomLoadingEmbed() ],
			components: []
		});

		await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate some delay for loading, purely cosmetic lol

		const exists = Database.prepare(`
			SELECT id
			FROM Snapshots
			WHERE id = ?
			AND guild_id = ?
		`).get(snapshotID, interaction.guild.id);
		if (!exists) {
			return interaction.editReply({
				embeds: [NoSnapshotEmbed]
			});
		}

		const data = ExportSnapshot(snapshotID, interaction.guild.id);

		function JSONReplacer(key, value) {
			return (typeof value === 'bigint') ? value.toString() + 'n' : value;
		}

		const serializedData = JSON.stringify(data, JSONReplacer);

		const hash = crypto.createHash(HASH_ALGORITHM).update(serializedData).digest('hex');

		const fileName = 'snapshot-' + snapshotID;

		Database.prepare(`
			INSERT INTO SnapshotExports (id, snapshot_id, guild_id, user_id, hash, algorithm)
			VALUES (?, ?, ?, ?, ?, ?)
		`).run(
			data.id,
			snapshotID,
			interaction.guild.id,
			interaction.user.id,
			hash,
			HASH_ALGORITHM
		);

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

		await interaction.editReply({
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