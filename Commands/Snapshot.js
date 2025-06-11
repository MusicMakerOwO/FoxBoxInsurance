const { SlashCommandBuilder } = require('@discordjs/builders');
const { COLOR, EMOJI, RandomLoadingEmbed, SNAPSHOT_TYPE, SECONDS } = require('../Utils/Constants');
const Database = require('../Utils/Database');
const { CreateSnapshot } = require('../Utils/SnapshotUtils');
const { isGuildRestoring } = require('../Utils/Parsers/RestoreJobs');
const https = require('node:https');
const crypto = require('node:crypto');

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

module.exports = {
	aliases: ['backup'],
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
					embeds: [{
						color: COLOR.ERROR,
						title: 'Restore in Progress',
						description: `
Managing snapshots while a restore is in progress can be dangerous!
Please proceed with caution and only if you know what you're doing ...`
					}],
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
				}).catch(console.error);
			}

			const button = client.buttons.get('snapshot-list');
			return button.execute(interaction, client, []);
		}

		if (subcommand === 'create') {
			if (isGuildRestoring(interaction.guild.id)) {
				return interaction.reply({
					embeds: [{
						color: COLOR.ERROR,
						title: 'Restore in Progress',
						description: 'You cannot create a snapshot while a restore is in progress.'
					}],
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


	}
}