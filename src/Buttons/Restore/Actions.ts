import { ButtonHandler } from "../../Typings/HandlerTypes.js";
import { COLOR, DIFF_CHANGE_PREFIX, DIFF_CHANGE_TYPE, EMOJI, RESTORE_OPTION_NAMES, RESTORE_OPTIONS } from "../../Utils/Constants.js";
import { GetGuildSnapshot } from "../../Services/SnapshotLookup.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { DiscordActionRow, DiscordButton, DiscordButtonStyle } from "../../Typings/DiscordTypes.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";
import { BuildRestorePlan, RestoreAction, RestorePlanError } from "../../Services/RestorePlans.js";
import { Database } from "../../Database.js";

const PAGE_SIZE = 10;
const DESTRUCTIVE_FILTER = 'destructive';

/** @internal Exported for tests, not part of the module's API. */
export function FormatCount(n: number): string {
	if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
	return String(n);
}

/** @internal Exported for tests, not part of the module's API. */
export async function DescribeAction(action: RestoreAction): Promise<string> {
	let line = `${DIFF_CHANGE_PREFIX[action.change_type]} ${action.label}`;
	if (action.change_type === DIFF_CHANGE_TYPE.UPDATE && action.detail) line += ` · ${action.detail}`;

	if (action.category === RESTORE_OPTIONS.CHANNELS && action.change_type === DIFF_CHANGE_TYPE.DELETE) {
		const count = await Database.query('SELECT COUNT(*) as count FROM Messages WHERE channel_id = ?', [action.target_id]).then(res => Number(res[0].count));
		if (count > 0) return `${line} · ${FormatCount(count)} saved message${count === 1 ? '' : 's'}`;
	}

	return line;
}

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.RESTORE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : true,
	customID      : 'restore-actions',
	execute       : async function(interaction, client, args) {
		const [id, maskArg, categoryArg, pageArg, filterArg] = args;
		const mask = parseInt(maskArg) || 0;
		const category = parseInt(categoryArg) as RestoreAction['category'];
		const destructiveOnly = filterArg === DESTRUCTIVE_FILTER;

		const requestedPage = pageArg === 'first' ? 0
			: pageArg === 'last' ? Infinity // clamped below, once the count is known
			: parseInt(pageArg) || 0;

		const snapshotData = await GetGuildSnapshot(interaction.guildId!, id);
		if (!snapshotData) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'Snapshot Not Found',
					description: `Snapshot not found or already deleted\nCreate one using \`/snapshot create\``
				}],
				components: []
			}
		}

		let plan;
		try {
			plan = await BuildRestorePlan(interaction.guild!, snapshotData, mask);
		} catch (error) {
			if (error instanceof RestorePlanError) {
				return {
					embeds: [{
						color: COLOR.ERROR,
						title: 'Could Not Build Restore Plan',
						description: error.message
					}]
				}
			}
			throw error;
		}

		const categoryActions = plan.actions.filter(action =>
			action.category === category && (!destructiveOnly || action.change_type === DIFF_CHANGE_TYPE.DELETE)
		);

		const lastPage = Math.max(0, Math.ceil(categoryActions.length / PAGE_SIZE) - 1);
		const page = Math.min(Math.max(requestedPage, 0), lastPage);

		const visibleActions = categoryActions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
		const lines = visibleActions.length > 0
			? await Promise.all(visibleActions.map(DescribeAction))
			: ['No actions to display on this page.'];

		const filterSegment = destructiveOnly ? DESTRUCTIVE_FILTER : '';

		const pageButtons: DiscordActionRow<DiscordButton> = {
			type: 1,
			components: [
				{
					type: 2,
					style: DiscordButtonStyle.SECONDARY,
					emoji: { name: EMOJI.FIRST_PAGE },
					custom_id: `restore-actions_${id}_${mask}_${category}_first_${filterSegment}`,
					disabled: page === 0
				},
				{
					type: 2,
					style: DiscordButtonStyle.SECONDARY,
					emoji: { name: EMOJI.PREVIOUS_PAGE },
					custom_id: `restore-actions_${id}_${mask}_${category}_${page - 1}_${filterSegment}`,
					disabled: page === 0
				},
				{
					type: 2,
					style: DiscordButtonStyle.SECONDARY,
					label: `Page ${page + 1} / ${lastPage + 1}`,
					custom_id: 'null',
					disabled: true
				},
				{
					type: 2,
					style: DiscordButtonStyle.SECONDARY,
					emoji: { name: EMOJI.NEXT_PAGE },
					custom_id: `restore-actions_${id}_${mask}_${category}_${page + 1}_${filterSegment}`,
					disabled: (page + 1) * PAGE_SIZE >= categoryActions.length
				},
				{
					type: 2,
					style: DiscordButtonStyle.SECONDARY,
					emoji: { name: EMOJI.LAST_PAGE },
					custom_id: `restore-actions_${id}_${mask}_${category}_last_${filterSegment}`,
					disabled: (page + 1) * PAGE_SIZE >= categoryActions.length
				}
			]
		}

		const filterRow: DiscordActionRow<DiscordButton> = {
			type: 1,
			components: [
				{
					type: 2,
					style: destructiveOnly ? DiscordButtonStyle.SUCCESS : DiscordButtonStyle.SECONDARY,
					label: 'Destructive only',
					emoji: { name: EMOJI.WARNING },
					custom_id: `restore-actions_${id}_${mask}_${category}_0_${destructiveOnly ? '' : DESTRUCTIVE_FILTER}`,
				},
				{
					type: 2,
					style: DiscordButtonStyle.SECONDARY,
					label: 'Back to preview',
					emoji: { name: EMOJI.SEARCH },
					custom_id: `restore-preview_${id}_${mask}`,
				}
			]
		}

		return {
			embeds: [{
				color: COLOR.PRIMARY,
				title: `Restore Actions - ${RESTORE_OPTION_NAMES[category]}`,
				description: lines.join('\n')
			}],
			components: [pageButtons, filterRow]
		}
	}
} satisfies ButtonHandler as ButtonHandler;