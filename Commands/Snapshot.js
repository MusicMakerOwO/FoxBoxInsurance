const { SlashCommandBuilder } = require('@discordjs/builders');
const { COLOR, EMOJI, RandomLoadingEmbed, SNAPSHOT_TYPE, SECONDS } = require('../Utils/Constants');
const Database = require('../Utils/Database');
const { CreateSnapshot } = require('../Utils/SnapshotUtils');
const { isGuildRestoring } = require('../Utils/Parsers/RestoreJobs');
const https = require('node:https');
const crypto = require('node:crypto');
const { SNAPSHOT_ERRORS } = require('../Utils/SnapshotImport/errors');
const Log = require('../Utils/Logs');
const { ParseFunctions } = require('../Utils/SnapshotImport/ParseFunctions');

const noPermissionEmbed = {
	color: COLOR.ERROR,
	title: 'Missing Permissions',
	description: 'You must be a server administrator for this'
}

const ownerEmbed = {
	color: COLOR.ERROR,
	title: 'Missing Permissions',
	description: 'Only the server owner can use this command'
}

const disabledEmbed = {
	color: COLOR.ERROR,
	title: 'Snapshots Disabled',
	description: 'Snapshots are disabled on this server\nPlease enable them first'
}

const CorruptedSnapshotEmbed = {
	color: COLOR.ERROR,
	title: 'Snapshot Corrupted',
	description: 'The provided snapshot file is corrupted - Please export the snapshot again!'
}

const FileMismatchEmbed = {
	color: COLOR.ERROR,
	title: 'File Mismatch',
	description: 'The uploaded file does not match the expected snapshot format. Please create a new export and try again.'
}

const BadVersionEmbed = {
	color: COLOR.ERROR,
	title: 'Unsupported Snapshot',
	description: `The snapshot is outdated or not supported at the current moment\nPlease export the snapshot again or contact support`
}

const ImportErrorEmbed = {
	color: COLOR.ERROR,
	title: 'Snapshot Import Error',
	description: 'An unknown error occurred while importing the snapshot\nPlease try again or contact support if continued 💔'
}

const RestoreWarningEmbed = {
	color: COLOR.ERROR,
	title: 'Restore in Progress',
	description: `
Managing snapshots while a restore is in progress can be dangerous!
Please proceed with caution and only if you know what you're doing ...`
}

const RestoreInProgressEmbed = {
	color: COLOR.ERROR,
	title: 'Restore in Progress',
	description: 'You cannot create a snapshot while a restore is in progress.'
}

const InvalidFileEmbed = {
	color: COLOR.ERROR,
	title: 'Invalid File',
	description: 'Please upload a valid snapshot file in JSON format.'
}

const InvalidJSONEmbed = {
	color: COLOR.ERROR,
	title: 'Invalid JSON',
	description: 'The uploaded file is not a valid JSON snapshot.'
}

module.exports = {
	aliases: ['backup'],
	examples: [
		'/snapshot create',
		'/snapshot list',
		'/snapshot disable',
		'/snapshot import <file>'
	],
	data: new SlashCommandBuilder()
		.setName('snapshot')
		.setDescription('Manage server snapshots')
		.addSubcommand(x => x
			.setName('create')
			.setDescription('What a pretty picture :D')
		)
		.addSubcommand(x => x
			.setName('list')
			.setDescription('List all snapshots')
		)
		.addSubcommand(x => x
			.setName('import')
			.setDescription('Import a snapshot from a file')
			.addAttachmentOption(x => x
				.setName('file')
				.setDescription('The snapshot file to import')
				.setRequired(true)
			)
		)
		.addSubcommand(x => x
			.setName('manage')
			.setDescription('Manage a snapshot (alias for list)')
		)
		.addSubcommand(x => x
			.setName('restore')
			.setDescription('Restore a snapshot (alias for list)')
		)
		.addSubcommand(x => x
			.setName('disable')
			.setDescription('Disable server snapshots')
		)
		.addSubcommand(x => x
			.setName('enable')
			.setDescription('Enable server snapshots')
		),
	execute: async function(interaction, client) {
		if (!interaction.member.permissions.has('Administrator')) {
			return interaction.reply({ embeds: [noPermissionEmbed], ephemeral: true });
		}

		const subcommand = interaction.options.getSubcommand();
		if (subcommand === 'disable' || subcommand === 'enable') {
			if (interaction.user.id !== interaction.guild.ownerId) {
				return interaction.reply({ embeds: [ownerEmbed], ephemeral: true });
			}

			const enabled = subcommand === 'enable' ? 1 : 0;
			const emoji = subcommand === 'enable' ? EMOJI.SUCCESS : EMOJI.ERROR;
			const guildId = interaction.guild.id;

			Database.prepare('UPDATE Guilds SET snapshots_enabled = ? WHERE id = ?').run(enabled, guildId);

			const embed = {
				color: COLOR.PRIMARY,
				description: `${emoji} Automatic snapshots have been ${enabled ? 'enabled' : 'disabled'}.`,
			}
			
			return interaction.reply({ embeds: [embed], ephemeral: true });
		}

		const enabled = Database.prepare('SELECT snapshots_enabled FROM Guilds WHERE id = ?').pluck().get(interaction.guild.id);
		if (!enabled) {
			return interaction.reply({ embeds: [disabledEmbed], ephemeral: true });
		}

		if (subcommand === 'list' || subcommand === 'manage' || subcommand === 'restore') {

			if (isGuildRestoring(interaction.guild.id)) {
				// give a warning and ask for confirmation
				return interaction.reply({
					embeds: [ RestoreWarningEmbed ],
					components: [{
						type: 1,
						components: [{
							type: 2,
							style: 4, // Danger button
							label: 'I understand the risks',
							custom_id: 'snapshot-list',
							emoji: '⚠️'
						}]
					}],
					ephemeral: true
				});
			}

			const button = client.buttons.get('snapshot-list');
			return button.execute(interaction, client, []);
		}

		if (subcommand === 'create') {
			if (isGuildRestoring(interaction.guild.id)) {
				return interaction.reply({
					embeds: [ RestoreInProgressEmbed ],
					ephemeral: true
				});
			}

			await interaction.reply({ embeds: [ RandomLoadingEmbed() ], ephemeral: true });

			const start = process.hrtime.bigint();
			const snapshotID = await CreateSnapshot(interaction.guild, SNAPSHOT_TYPE.MANUAL);
			const end = process.hrtime.bigint();
			const waitTime = Math.max(2000, Number(end - start) / 1_000_000);
			await new Promise(resolve => setTimeout(resolve, waitTime));

			const button = client.buttons.get('snapshot-manage');
			return button.execute(interaction, client, [ snapshotID ]); // Pass the snapshot ID to the button
		}

		if (subcommand === 'import') {
			await interaction.deferReply({ ephemeral: true });

			const attachment = interaction.options.getAttachment('file');
			if (!attachment || !attachment.name.endsWith('.json')) {
				return interaction.editReply({ 
					embeds: [ InvalidFileEmbed ],
				});
			}

			const fileContent = await DownloadURL(attachment.url);
			try {
				var snapshotData = JSON.parse(fileContent);
			} catch (error) {
				return interaction.editReply({ 
					embeds: [ InvalidJSONEmbed ],
				});
			}

			const exportID = snapshotData.id || null; // XXXX-XXXX-XXXX-XXXX
			const EXPORT_REGEX = /^[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/i;
			if (typeof exportID !== 'string' || !EXPORT_REGEX.test(exportID)) {
				console.log(`Invalid export ID format: ${exportID}`);
				return interaction.editReply({ 
					embeds: [ CorruptedSnapshotEmbed ]
				});
			}

			if (!client.ttlcache.has(`import-${exportID}`)) {
				const exportMetadata = Database.prepare(`
					SELECT id, snapshot_id, guild_id, hash, algorithm, length, version
					FROM SnapshotExports
					WHERE id = ?
				`).get(exportID);
				if (!exportMetadata || exportMetadata.revoked === 1) {
					console.log(`Snapshot export not found or revoked: ${exportID}`);
					return interaction.editReply({ 
						embeds: [ FileMismatchEmbed ]
					});
				}

				if (
					typeof snapshotData !== 'object' || !snapshotData ||
					typeof snapshotData.version !== 'number' ||
					typeof snapshotData.id !== 'string'
				) {
					console.log(`Snapshot data is not a valid object or missing root fields`);
					return interaction.editReply({ 
						embeds: [ CorruptedSnapshotEmbed ]
					});
				}

				if (exportMetadata.version !== snapshotData.version) {
					console.log(`Snapshot version mismatch: expected ${exportMetadata.version}, got ${snapshotData.version}`);
					return interaction.editReply({
						embeds: [ FileMismatchEmbed ]
					});
				}

				if (!ParseFunctions.has(snapshotData.version)) {
					console.log(`Unsupported snapshot version: ${snapshotData.version}`);
					return interaction.editReply({
						embeds: [ BadVersionEmbed ]
					});
				}

				if (
					exportMetadata.length !== fileContent.length ||
					crypto.createHash(exportMetadata.algorithm).update(fileContent).digest('hex') !== exportMetadata.hash
				) {
					console.log(`Snapshot file length or hash mismatch: expected ${exportMetadata.length} bytes, got ${fileContent.length} bytes`);

					Database.prepare(`
						UPDATE SnapshotExports
						SET revoked = 1
						WHERE id = ?
					`).run(exportID);

					return interaction.editReply({
						embeds: [ CorruptedSnapshotEmbed ]
					});
				}

				const parse = ParseFunctions.get(snapshotData.version);
				try {
					// mutates the snapshot data in place
					parse(exportMetadata, snapshotData);
				} catch (error) {
					switch (error) {
						case SNAPSHOT_ERRORS.CORRUPTED:
						case SNAPSHOT_ERRORS.UNEXPECTED_FIELD:
							return interaction.editReply({
								embeds: [ CorruptedSnapshotEmbed ]
							});
						default:
							Log.error(error);
							return interaction.editReply({
								embeds: [ ImportErrorEmbed ]
							});
					}
				}

				client.ttlcache.set(`import-${exportID}`, {
					metadata: exportMetadata,
					data: snapshotData
				}, SECONDS.HOUR * 2 * 1000); // Store the snapshot data for 60 minutes
			}

			const importSnapshot = client.buttons.get('import');
			return importSnapshot.execute(interaction, client, [exportID]);
		}

		throw new Error(`Unknown subcommand: ${subcommand}`);
	}
}

function DownloadURL(url) {
	return new Promise((resolve, reject) => {
		https.get(url, (res) => {
			let data = [];
			res.on('data', chunk => data.push(chunk));
			res.on('end', () => resolve( Buffer.concat(data).toString('utf8') ));
		}).on('error', err => reject(err));
	});
}