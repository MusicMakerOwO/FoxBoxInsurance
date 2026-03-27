import {GetImportsForGuild} from "../../../CRUD/SnapshotImports";
import {COLOR, EMOJI} from "../../../Utils/Constants";
import {RemoveFormatting} from "../../../Utils/RemoveFormatting";
import {ButtonHandler} from "../../../Typings/HandlerTypes";
import { TOS_FEATURES } from "../../../TOSConstants";
import { DiscordActionRow, DiscordButton } from "../../../Typings/DiscordTypes";
import { DiscordPermissions } from "../../../Utils/DiscordConstants";

const PAGE_SIZE = 25; // Not used here, but can be useful for pagination in the future

export default {
	tos_features  : [ TOS_FEATURES.IMPORT_SNAPSHOTS ],
	guild_features: [],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : false,
	customID      : 'import-view-channels',
	execute       : async function(interaction, client, args) {
		const importID = args[0];
		const managed = args[1] || '';

		const page = parseInt(args[2]) || 0;
		if (isNaN(page) || page < 0) throw new Error('Invalid page number provided.');

		const availableImports = GetImportsForGuild(interaction.guildId!);
		const importData = availableImports.get(importID) ?? client.importCache.get(importID);
		if (!importData) return {
			embeds: [{
				color: COLOR.ERROR,
				description: 'Import has expired - Please re-import the snapshot'
			}],
			components: []
		}

		const embed = {
			color: COLOR.PRIMARY,
			title: `Import ${importData.id} (Bans)`,
			description: '',
			footer: {
				text: `Total Bans: ${importData.bans.length}`
			}
		}

		if (importData.channels.length === 0) {
			embed.description = 'No channels found in this import :(';
		} else {
			const selectedChannels = importData.channels.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
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
					emoji: { name: EMOJI.FIRST_PAGE },
					custom_id: `import-view-channels_${importID}_${managed}_0_`,
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					emoji: { name: EMOJI.PREVIOUS_PAGE },
					custom_id: `import-view-channels_${importID}_${managed}_${page - 1}`,
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					custom_id: 'null',
					label: `Page ${page + 1} / ${Math.ceil(importData.channels.length / PAGE_SIZE)}`,
					disabled: true
				},
				{
					type: 2,
					style: 2,
					emoji: { name: EMOJI.NEXT_PAGE },
					custom_id: `import-view-channels_${importID}_${managed}_${page + 1}`,
					disabled: (page + 1) * PAGE_SIZE >= importData.channels.length
				},
				{
					type: 2,
					style: 2,
					emoji: { name: EMOJI.LAST_PAGE },
					custom_id: `import-view-channels_${importID}_${managed}_${~~(importData.channels.length / PAGE_SIZE)}_`,
					disabled: (page + 1) * PAGE_SIZE >= importData.channels.length
				}
			]
		}

		const backButton: DiscordActionRow<DiscordButton> = {
			type: 1,
			components: [
				{
					type: 2,
					style: 4,
					custom_id: managed ? `snapshot-manage_${importID}_${managed}` : `import_${importID}`,
					label: 'Back'
				}
			]
		}

		return {
			embeds: [embed],
			components: importData.channels.length > PAGE_SIZE ? [navButtons, backButton] : [backButton]
		}
	}
} satisfies ButtonHandler as ButtonHandler;