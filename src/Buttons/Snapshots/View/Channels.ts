import {ButtonHandler} from "../../../Typings/HandlerTypes";
import {COLOR, EMOJI} from "../../../Utils/Constants";
import {RemoveFormatting} from "../../../Utils/RemoveFormatting";
import {GetSnapshot} from "../../../CRUD/Snapshots";
import { TOS_FEATURES } from "../../../TOSConstants";
import { DiscordActionRow, DiscordButton } from "../../../Typings/DiscordTypes";
import { GUILD_FEATURES } from "../../../Typings/DatabaseTypes";
import { DiscordPermissions } from "../../../Utils/DiscordConstants";

const PAGE_SIZE = 25;

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.MANAGE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : false,
	customID      : 'snapshot-view-channels',
	execute       : async function(interaction, client, args) {
		const snapshotID = parseInt(args[0]);
		if (isNaN(snapshotID) || snapshotID <= 0) throw new Error('Invalid snapshot ID provided.');

		const page = parseInt(args[1]) || 0;
		if (isNaN(page) || page < 0) throw new Error('Invalid page number provided.');

		const snapshotData = await GetSnapshot(snapshotID);
		if (!snapshotData) return {
			embeds: [{
				color: COLOR.ERROR,
				description: 'Snapshot does not exist - Was it deleted?'
			}]
		}

		const embed = {
			color: COLOR.PRIMARY,
			title: `Snapshot #${snapshotID} (Channels)`,
			description: '',
			footer: {
				text: `Total Channels: ${snapshotData.channels.size}`
			}
		}

		if (snapshotData.channels.size === 0) {
			embed.description = 'No channels found in this snapshot :(';
		} else {
			const selectedChannels = Array.from(snapshotData.channels.values()).slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
			if (selectedChannels.length === 0) {
				embed.description = 'No more channels to display on this page.';
			} else {
				embed.description = selectedChannels.map(channel =>
					'#' + RemoveFormatting(channel.name)
				).join('\n');
			}
		}

		const navButtons: DiscordActionRow<DiscordButton> = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-channels_${snapshotID}_0_`,
					emoji: { name: EMOJI.FIRST_PAGE },
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-channels_${snapshotID}_${page - 1}`,
					emoji: { name: EMOJI.PREVIOUS_PAGE },
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					custom_id: 'null',
					label: `Page ${page + 1} / ${Math.ceil(snapshotData.channels.size / PAGE_SIZE)}`,
					disabled: true
				},
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-channels_${snapshotID}_${page + 1}`,
					emoji: { name: EMOJI.NEXT_PAGE },
					disabled: (page + 1) * PAGE_SIZE >= snapshotData.channels.size
				},
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-channels_${snapshotID}_${~~(snapshotData.channels.size / PAGE_SIZE)}_`,
					emoji: { name: EMOJI.LAST_PAGE },
					disabled: (page + 1) * PAGE_SIZE >= snapshotData.channels.size
				}
			]
		}

		const backButton: DiscordActionRow<DiscordButton> = {
			type: 1,
			components: [
				{
					type: 2,
					style: 4,
					custom_id: `snapshot-manage_${snapshotID}`,
					label: 'Back'
				}
			]
		}

		return {
			embeds: [embed],
			components: snapshotData.channels.size > PAGE_SIZE ? [navButtons, backButton] : [backButton]
		}
	}
} satisfies ButtonHandler as ButtonHandler;