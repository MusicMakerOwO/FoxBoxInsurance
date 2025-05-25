const { SlashCommandBuilder } = require('@discordjs/builders');
const { COLOR, STATUS_EMOJI, RandomLoadingEmbed, SNAPSHOT_TYPE } = require('../Utils/Constants');
const Database = require('../Utils/Database');
const { CreateSnapshot } = require('../Utils/SnapshotUtils');

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
			const emoji = subcommand === 'enable' ? STATUS_EMOJI.SUCCESS : STATUS_EMOJI.ERROR;
			const guildId = interaction.guild.id;

			Database.prepare('UPDATE Guilds SET snapshots_enabled = ? WHERE id = ?').run(enabled, guildId);

			const embed = {
				color: COLOR.PRIMARY,
				description: `${emoji} Automatic snapshots have been ${enabled ? 'enabled' : 'disabled'}.`,
			}
			
			return interaction.reply({ embeds: [embed], ephemeral: true });
		}

		const enabled = Database.prepare('SELECT snapshots_enabled FROM Guilds WHERE id = ?').get(interaction.guild.id);
		if (!enabled || enabled.snapshots_enabled === 0) {
			return interaction.reply({ embeds: [disabledEmbed], ephemeral: true });
		}

		if (subcommand === 'list' || subcommand === 'manage') {
			const button = client.buttons.get('snapshot-list');
			return button.execute(interaction, client, []);
		}

		if (subcommand === 'create') {
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