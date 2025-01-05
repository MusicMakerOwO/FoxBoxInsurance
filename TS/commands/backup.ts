import { SlashCommandBuilder } from "@discordjs/builders";
import Database from "../Utils/Database";
import CreateBackup, { BackupType } from "../Utils/Storage/CreateBackup";
import { CommandFile, CommandInteraction, MicroClient } from "../typings";

export default {
	data: new SlashCommandBuilder()
		.setName('backup')
		.setDescription('Manage backups for this server.')
		.addSubcommand(x => x
			.setName('create')
			.setDescription('Create a new backup.')
		)
		.addSubcommand(x => x
			.setName('list')
			.setDescription('List all backups.')
		),
	async execute(interaction: CommandInteraction, client: MicroClient, page = 0) {
		const subCommand = interaction.options.getSubcommand();

		await interaction.deferReply({ ephemeral: true });

		if (subCommand === 'create') {
			const backupID = CreateBackup(interaction.guild!, client, BackupType.MANUAL);
			if (!backupID) {
				await interaction.editReply('Failed to create backup.');
				return;
			}

			const channelCount = Database.prepare('SELECT COUNT(*) as count FROM BackupChannel WHERE backup_id = ?').pluck().get(backupID) as number;
			const roleCount = Database.prepare('SELECT COUNT(*) as count FROM BackupRole WHERE backup_id = ?').pluck().get(backupID) as number;

			const embed = {
				color: 0xff7900,
				title: 'Backup Created',
				description: `Backup ID: ${backupID}\nChannels: ${channelCount}\nRoles: ${roleCount}`
			}

			const manageButtons = {
				type: 1,
				components: [
					{
						type: 2,
						style: 2,
						label: 'View',
						emoji: '🔍',
						custom_id: `backup_${backupID}_view`
					},
					{
						type: 2,
						style: 2,
						label: 'Download',
						emoji: '📥',
						custom_id: `backup_${backupID}_export`
					}
				]
			}

			await interaction.editReply({ embeds: [embed], components: [manageButtons] });
			return;
		}


		if (subCommand === 'list') {
			const button = client.buttons.get('backup')!;
			button.execute(interaction, client, ['0', 'list']);
			return;
		}

	}
} as CommandFile & { execute: (interaction: CommandInteraction, client: MicroClient, page?: number) => Promise<any> };