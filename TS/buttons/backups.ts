import Database from "../Utils/Database";
import { BackupType } from "../Utils/Storage/CreateBackup";
import { ButtonInteraction, CommandInteraction, MicroClient } from "../typings";

const PAGE_SIZE = 5;

export default {
	customID: 'backup',
	execute: async function (interaction: ButtonInteraction | CommandInteraction, client: MicroClient, [backupID, action, page]: [number, string, number | null]) {
		backupID = Number(backupID);
		page = Number(page) || 0;

		if (interaction.deferUpdate) await interaction.deferUpdate({}).catch(() => { });

		if (action === 'view') {
			const backupInfo = Database.prepare('SELECT * FROM Backups WHERE id = ?').get(backupID) as { id: number, type: number, created_at: string };
			const channelCount = Database.prepare('SELECT COUNT(*) as count FROM BackupChannel WHERE backup_id = ?').pluck().get(backupID) as number;
			const roleCount = Database.prepare('SELECT COUNT(*) as count FROM BackupRole WHERE backup_id = ?').pluck().get(backupID) as number;
			const messageCount = Database.prepare('SELECT COUNT(*) as count FROM Messages WHERE created_at < ?').pluck().get(backupInfo.created_at) as number;

			const embed = {
				color: 0xff7900,
				title: 'Backup Info',
				description: `
Backup ID: \`${backupID}\`
Backup Type: \`${BackupType[backupInfo.type]}\`
Created At: <t:${Math.trunc( new Date(backupInfo.created_at).getTime() / 1000 )}:d>
Expires At: 

Channels: ${channelCount}
Roles: ${roleCount}
Messages: ${messageCount}`
			}

			const viewButtons = {
				type: 1,
				components: [
					{
						type: 2,
						style: 2,
						label: 'Channels',
						custom_id: `backup_${backupID}_channels`,
					},
					{
						type: 2,
						style: 2,
						label: 'Roles',
						custom_id: `backup_${backupID}_roles`
					},
					{
						type: 2,
						style: 2,
						label: 'Bans',
						custom_id: `backup_${backupID}_bans`
					}
				]
			}

			const manageButtons = {
				type: 1,
				components: [
					{
						type: 2,
						style: 2,
						label: 'Download',
						emoji: '📥',
						custom_id: `backup_${backupID}_export`
					},
					{
						type: 2,
						style: 4,
						label: 'Delete',
						emoji: '🗑️',
						custom_id: `backup_${backupID}_delete`,
						disabled: interaction.user.id !== interaction.guild!.ownerId
					},
					{
						type: 2,
						style: 3,
						label: 'Restore',
						emoji: '🔄',
						custom_id: `backup_${backupID}_restore`,
						disabled: interaction.user.id !== interaction.guild!.ownerId
					}
				]
			}

			await interaction.editReply({ embeds: [embed], components: [viewButtons, manageButtons] });
			return;
		}

		if (action === 'list') {
			const backups = Database.prepare(`
				SELECT id, type, created_at
				FROM Backups
				WHERE guild_id = ?
				LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}
			`).all(interaction.guild!.id) as { id: number, type: number, created_at: string }[];

			const nextBackup = new Date();
			nextBackup.setHours( Number(BigInt(interaction.guild!.id) % 24n), 0, 0);

			const embed = {
				color: 0xff7900,
				title: `Backups for ${interaction.guild!.name}`,
				description: `Next backup at <t:${Math.trunc( nextBackup.getTime() / 1000 )}:t>`,
			}

			for (let i = 0; i <= Math.min(PAGE_SIZE, backups.length - 1); i++) {
				const backup = backups[i];
				embed.description += `\n
Backup ID: \`${backup.id}\`
Type: \`${BackupType[backup.type]}\`
Created At: <t:${Math.trunc( new Date(backup.created_at).getTime() / 1000 )}:d>`;
			}

			const navButtons = {
				type: 1,
				components: [
					{
						type: 2,
						style: 1,
						emoji: '⬅️',
						custom_id: `backup_${backupID}_list_${page - 1}`,
						disabled: page === 0
					},
					{
						type: 2,
						style: 2,
						label: `${page + 1} / ${Math.ceil(backups.length / PAGE_SIZE)}`,
						custom_id: 'null',
						disabled: true
					},
					{
						type: 2,
						style: 1,
						label: 'Next',
						emoji: '➡️',
						custom_id: `backup_${backupID}_list_${page + 1}`,
						disabled: backups.length < PAGE_SIZE
					}
				]
			}

			const dropdown = {
				type: 1,
				components: [{
					type: 3,
					custom_id: 'viewBackup',
					options: backups.map(backup => ({
						label: `Backup ID: ${backup.id}`,
						value: backup.id.toString()
					}))
				}]
			}

			await interaction.editReply({ embeds: [embed], components: [navButtons, dropdown] });
			return;
		}

		
	}
}