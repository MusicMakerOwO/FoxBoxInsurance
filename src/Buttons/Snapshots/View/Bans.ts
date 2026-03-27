import {ButtonHandler} from "../../../Typings/HandlerTypes";
import {COLOR, EMOJI} from "../../../Utils/Constants";
import {GetSnapshot} from "../../../CRUD/Snapshots";
import { TOS_FEATURES } from "../../../TOSConstants";
import { DiscordActionRow, DiscordButton } from "../../../Typings/DiscordTypes";
import { GUILD_FEATURES } from "../../../Typings/DatabaseTypes";
import { DiscordPermissions } from "../../../Utils/DiscordConstants";

function ShortText(text = '', maxLength = 100) {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength - 3).trim() + '...';
}

const PAGE_SIZE = 25;

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.MANAGE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : false,
	customID      : 'snapshot-view-bans',
	execute       : async function(interaction, client, args) {

		const snapshotID = parseInt(args[0]);
		if (isNaN(snapshotID) || snapshotID <= 0) throw new Error('Invalid snapshot ID provided.');

		const page = parseInt(args[1]) || 0;
		if (isNaN(page) || page < 0) throw new Error('Invalid page number provided.');

		const snapshot = await GetSnapshot(snapshotID);
		if (!snapshot) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					description: `${EMOJI.ERROR} Snapshot no longer exists`
				}]
			}
		}

		const embed = {
			color: COLOR.PRIMARY,
			title: `Snapshot #${snapshotID} (Bans)`,
			description: '',
			footer: {
				text: `Total Bans: ${snapshot.bans.size}`
			}
		}

		const bans = Array.from(snapshot.bans.values());

		if (snapshot.bans.size === 0) {
			embed.description = 'No bans found in this snapshot :(';
		} else {
			const selectedBans = bans.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
			if (selectedBans.length === 0) {
				embed.description = 'No more bans to display on this page.';
			} else {
				embed.description = selectedBans.map(ban =>
					`<@${ban.id}> (${ban.id}) - ${ShortText(ban.reason || 'No reason provided', 50)}`
				).join('\n');
			}
		}

		const navButtons: DiscordActionRow<DiscordButton> = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-bans_${snapshotID}_0_`,
					emoji: { name: EMOJI.FIRST_PAGE },
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-bans_${snapshotID}_${page - 1}`,
					emoji: { name: EMOJI.PREVIOUS_PAGE },
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					custom_id: 'null',
					label: `Page ${page + 1} / ${Math.ceil(bans.length / PAGE_SIZE)}`,
					disabled: true
				},
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-bans_${snapshotID}_${page + 1}`,
					emoji: { name: EMOJI.NEXT_PAGE },
					disabled: (page + 1) * PAGE_SIZE >= bans.length
				},
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-bans_${snapshotID}_${~~(bans.length / PAGE_SIZE)}_`,
					emoji: { name: EMOJI.LAST_PAGE },
					disabled: (page + 1) * PAGE_SIZE >= bans.length
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
			components: bans.length > PAGE_SIZE ? [navButtons, backButton] : [backButton]
		}
	}
} satisfies ButtonHandler as ButtonHandler;