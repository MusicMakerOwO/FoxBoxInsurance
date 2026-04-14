import {ButtonHandler} from "../../Typings/HandlerTypes";
import {GetImportsForGuild} from "../../CRUD/SnapshotImports";
import {COLOR, EMOJI, SECONDS, SNAPSHOT_TYPE, SNAPSHOT_TYPE_EMOJI, SNAPSHOT_TYPE_NAME} from "../../Utils/Constants";
import {
	GetSnapshot,
	isSnapshotQueuedForDeletion,
	JSONSnapshot,
	ListSnapshotsForGuild,
	MaxSnapshotsForGuild,
	Snapshot
} from "../../CRUD/Snapshots";
import { TOS_FEATURES } from "../../TOSConstants";
import {
	DiscordActionRow,
	DiscordButton,
	DiscordStringSelect,
	DiscordStringSelectOption
} from "../../Typings/DiscordTypes";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes";
import { DiscordPermissions } from "../../Utils/DiscordConstants";

const PAGE_SIZE = 5;

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.MANAGE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : false,
	customID      : 'snapshot-list',
	execute       : async function(interaction, client, args) {

		const input = args[0];
		let page: number;
		if (input === 'first') {
			page = 0;
		} else if (input === 'last') {
			page = Infinity; // will be reduced when we know the item count
		} else {
			page = parseInt(input, 10) || 0; // default to first page if invalid
		}

		const items = new Array<
			{
				type: typeof SNAPSHOT_TYPE.IMPORT,
				data: JSONSnapshot & { expires_at: number }
			} |
			{
				type: typeof SNAPSHOT_TYPE.MANUAL | typeof SNAPSHOT_TYPE.AUTOMATIC,
				id: Snapshot['id']
			}
		>();

		const availableImports = GetImportsForGuild(interaction.guildId!);
		for (const snapshot of availableImports.values()) {
			items.push({ type: SNAPSHOT_TYPE.IMPORT, data: snapshot })
		}

		const availableSnapshots = await ListSnapshotsForGuild(interaction.guildId!);
		// sort in order of newest -> oldest
		availableSnapshots.sort( (a, b) => b.id - a.id);
		for (const snapshot of availableSnapshots) {
			items.push({ type: snapshot.type as 0 | 1, id: snapshot.id });
		}

		if (items.length === 0) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'No Snapshots',
					description: `
No snapshots found for this server :(
Create one using \`/snapshot create\``
				}],
				components: []
			}
		}

		const visibleItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

		const maxSnapshots = await MaxSnapshotsForGuild(interaction.guildId!);

		const embed = {
			color: COLOR.PRIMARY,
			title: `Snapshot List (used ${availableSnapshots.length}/${maxSnapshots} slots)`,
			description: ''
		}

		const dropdownOptions: DiscordStringSelectOption[] = [];

		if (visibleItems[0].type === SNAPSHOT_TYPE.IMPORT) {
			embed.description = `> **You have ${availableImports.size} imports available:**`
		}

		for (const item of visibleItems) {
			if (item.type === SNAPSHOT_TYPE.IMPORT) {
				const expiresAt = ~~(item.data.expires_at / 1000);

				// beware of the space at the end of this first line!
				embed.description += `\n> 
> ${EMOJI.IMPORT} **Import ${item.data.id}** - Expires <t:${expiresAt}:R>
> | Channels: ${item.data.channels.length}
> | Roles: ${item.data.roles.length}
> | Bans: ${item.data.bans.length}`;

				dropdownOptions.push({
					label: `Import ${item.data.id}`,
					value: item.data.id,
					description: `Channels: ${item.data.channels.length}, Roles: ${item.data.roles.length}, Bans: ${item.data.bans.length}`,
					emoji: { name: EMOJI.IMPORT }
				});
			} else {
				const snapshotData = (await GetSnapshot(item.id))!;
				const createdAt = new Date(snapshotData.created_at).getTime();
				const emoji = snapshotData.pinned ? EMOJI.PIN : EMOJI.SNAPSHOT;

				const queuedDeletion = await isSnapshotQueuedForDeletion(item.id);

				embed.description += `\n
${queuedDeletion ? `**${EMOJI.WARNING} This snapshot is pending deletion**` : ''}
${emoji} **Snapshot #${item.id}** - \`${SNAPSHOT_TYPE_NAME[snapshotData.type]}\` ${SNAPSHOT_TYPE_EMOJI[snapshotData.type]}
| Channels: ${snapshotData.channels.size}
| Roles: ${snapshotData.roles.size}
| Bans: ${snapshotData.bans.size}
Created at <t:${~~(createdAt / 1000)}:d>`;

				dropdownOptions.push({
					label: `Snapshot #${item.id}`,
					value: item.id.toString(),
					description: `Channels: ${snapshotData.channels.size}, Roles: ${snapshotData.roles.size}, Bans: ${snapshotData.bans.size}`,
					emoji: { name: emoji }
				});
			}
		}

		const guildHour = BigInt(interaction.guildId!) % 24n;
		embed.description += `\n\n**Snapshots occur once per day at <t:${Number(guildHour) * 3600 + SECONDS.HOUR}:t>**`;

		const pageButtons: DiscordActionRow<DiscordButton> = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					emoji: { name: EMOJI.FIRST_PAGE },
					custom_id: `snapshot-list_first`,
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					emoji: { name: EMOJI.PREVIOUS_PAGE },
					custom_id: `snapshot-list_${page - 1}`,
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					label: `Page ${page + 1} / ${Math.ceil(items.length / PAGE_SIZE)}`,
					custom_id: 'null',
					disabled: true
				},
				{
					type: 2,
					style: 2,
					emoji: { name: EMOJI.NEXT_PAGE },
					custom_id: `snapshot-list_${page + 1}`,
					disabled: ((page + 1) * PAGE_SIZE) < items.length
				},
				{
					type: 2,
					style: 2,
					emoji: { name: EMOJI.LAST_PAGE },
					custom_id: `snapshot-list_last`,
					disabled: ((page + 1) * PAGE_SIZE) < items.length
				}
			]
		}

		const dropdown: DiscordActionRow<DiscordStringSelect> = {
			type: 1,
			components: [{
				type: 3,
				custom_id: 'snapshot-view',
				options: dropdownOptions
			}]
		}

		return {
			embeds: [embed],
			components: items.length > PAGE_SIZE ? [pageButtons, dropdown] : [dropdown]
		}
	}
} satisfies ButtonHandler as ButtonHandler;