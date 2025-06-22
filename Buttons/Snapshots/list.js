const { COLOR, SNAPSHOT_TYPE, SNAPSHOT_TYPE_EMOJI, EMOJI, SECONDS } = require("../../Utils/Constants");
const Database = require("../../Utils/Database");
const { SnapshotStats, isSnapshotDeletable, MaxSnapshots } = require("../../Utils/SnapshotUtils");

const NoSnapshotEmbed = {
	color: COLOR.ERROR,
	title: 'No Snapshots',
	description: `
No snapshots found for this server :(
Create one using \`/snapshot create\``
}

const noPermissionEmbed = {
	color: COLOR.ERROR,
	title: 'Missing Permissions',
	description: 'You must be a server administrator for this'
}

const PAGE_SIZE = 5;

module.exports = {
	customID: 'snapshot-list',
	execute: async function(interaction, client, args) {

		let page = parseInt(args[0]) || 0;
		if (isNaN(page) || page < 0) {
			throw new Error('Invalid page number provided.');
		}

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		if (!interaction.member.permissions.has('Administrator')) {
			return interaction.editReply({
				embeds: [noPermissionEmbed],
				components: []
			});
		}

		const items = []; // ({ type: 'snapshot', id: number, created_at: number } | { type: 'import', id: string, expires_at: number })[]

		if (client.ttlcache.has(`guild-imports-${interaction.guild.id}`)) {
			const availableImports = client.ttlcache.get(`guild-imports-${interaction.guild.id}`);
			for (const [importID, expiresTimestamp] of availableImports.entries()) {
				items.push({ type: 'import', id: importID, expires_at: expiresTimestamp });
			}
		}

		const availableSnapshots = Database.prepare(`
			SELECT id, type, created_at
			FROM Snapshots
			WHERE guild_id = ?
			ORDER BY id DESC
		`).all(interaction.guild.id);
		for (const snapshot of availableSnapshots) {
			items.push({ type: 'snapshot', id: snapshot.id, created_at: snapshot.created_at });
		}

		if (items.length === 0) {
			return interaction.editReply({
				embeds: [NoSnapshotEmbed],
				components: []
			});
		}

		let startingIndex = page * PAGE_SIZE;
		if (startingIndex >= items.length) {
			startingIndex = 0; // Reset to first page if out of bounds
			page = 0;
		}

		const maxSnapshots = MaxSnapshots(interaction.guild.id);

		const embed = {
			color: COLOR.PRIMARY,
			title: `Snapshot List (${items.filter(x => x.type === 'snapshot').length} / ${maxSnapshots})`,
			description: ''
		}

		const dropdownOptions = [];

		if (startingIndex === 0 && items[0].type === 'import') {
			const availableImports = client.ttlcache.get(`guild-imports-${interaction.guild.id}`);
			embed.description += `> **You have ${availableImports.size} imports available:**\n> \n`;
		}

		for (let i = startingIndex; i < startingIndex + PAGE_SIZE && i < items.length; i++) {
			const item = items[i];
			if (item.type === 'import') {
				const importData = client.ttlcache.get(`import-${item.id}`);
				const expiresAt = ~~(item.expires_at / 1000);
				
				embed.description += `
> ${EMOJI.IMPORT} **Import #${importData.metadata.snapshot_id}** - Expires <t:${expiresAt}:R>
> | Channels: ${importData.data.channels.length}
> | Roles: ${importData.data.roles.length}
> | Bans: ${importData.data.bans.length}`.trim();

				// next item is also an import AND is on the same page
				if (items[i + 1]?.type === 'import' && ~~((i+1) / PAGE_SIZE) === page) {
					embed.description += '\n> \n';
				} else {
					embed.description += '\n\n';
				}

				dropdownOptions.push({
					label: `Import #${importData.metadata.snapshot_id}`,
					value: `import-${item.id}`,
					description: `Channels: ${importData.data.channels.length}, Roles: ${importData.data.roles.length}, Bans: ${importData.data.bans.length}`,
					emoji: EMOJI.IMPORT
				});
			} else if (item.type === 'snapshot') {
				const snapshotStats = SnapshotStats(item.id);
				const createdAt = new Date(snapshotStats.created_at).getTime();
				const emoji = snapshotStats.pinned ? EMOJI.PIN : EMOJI.SNAPSHOT;

				const queuedDeletion = snapshotStats.pinned === 0 && isSnapshotDeletable(item.id);

				embed.description += `
${queuedDeletion ? `**${EMOJI.WARNING} This snapshot is pending deletion**` : ''}
${emoji} **Snapshot #${item.id}** - \`${SNAPSHOT_TYPE[snapshotStats.type]}\` ${SNAPSHOT_TYPE_EMOJI[snapshotStats.type]}
| Channels: ${snapshotStats.channels}
| Roles: ${snapshotStats.roles}
| Bans: ${snapshotStats.bans}
Created at <t:${~~(createdAt / 1000)}:d>`.trim() + '\n\n';

				dropdownOptions.push({
					label: `Snapshot #${item.id}`,
					value: item.id.toString(),
					description: `Channels: ${snapshotStats.channels}, Roles: ${snapshotStats.roles}, Bans: ${snapshotStats.bans}`,
					emoji: emoji
				});
			}
		}

		const guildHour = BigInt(interaction.guild.id) % 24n;
		embed.description += `**Snapshots occur once per day at <t:${Number(guildHour) * 3600 + SECONDS.HOUR}:t>**`;

		const pageButtons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					emoji: EMOJI.FIRST_PAGE,
					custom_id: `snapshot-list_0_`,
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					emoji: EMOJI.PREVIOUS_PAGE,
					custom_id: `snapshot-list_${page - 1}`,
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					label: `Page ${page + 1}`,
					custom_id: 'null',
					disabled: true
				},
				{
					type: 2,
					style: 2,
					emoji: EMOJI.NEXT_PAGE,
					custom_id: `snapshot-list_${page + 1}`,
					disabled: startingIndex + PAGE_SIZE >= items.length
				},
				{
					type: 2,
					style: 2,
					emoji: EMOJI.LAST_PAGE,
					custom_id: `snapshot-list_${~~(items.length / PAGE_SIZE)}_`,
					disabled: startingIndex + PAGE_SIZE >= items.length
				}
			]
		}

		const dropdown = {
			type: 1,
			components: [{
				type: 3,
				custom_id: 'snapshot-view',
				options: dropdownOptions
			}]
		}

		interaction.editReply({
			embeds: [embed],
			components: items.length > PAGE_SIZE ? [pageButtons, dropdown] : [dropdown]
		})
	}
}