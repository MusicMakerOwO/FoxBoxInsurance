import { ButtonHandler } from "../../Typings/HandlerTypes.js";
import { COLOR, DIFF_CHANGE_PREFIX, DIFF_CHANGE_TYPE, EMOJI, RESTORE_OPTION_NAMES, RESTORE_OPTIONS } from "../../Utils/Constants.js";
import { GetImportsForGuild } from "../../CRUD/SnapshotImports.js";
import { GetSnapshot } from "../../CRUD/Snapshots.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { DiscordActionRow, DiscordButton, DiscordButtonStyle, DiscordStringSelect, DiscordStringSelectOption } from "../../Typings/DiscordTypes.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";
import { BuildRestorePlan, RestoreAction, RestorePlanError } from "../../Services/RestorePlans.js";

const PLANNED_CATEGORIES = ['CHANNELS', 'ROLES', 'BANS'] as const;

/**
 * How many entities the destructive callout names before it summarises the rest. The embed
 * description caps at 4096 characters and labels can be 100 each, so this cannot be unbounded.
 */
const MAX_DESTRUCTIVE_NAMED = 10;

/** Same budget, same reason - warnings are one per offending role and can run to dozens */
const MAX_WARNINGS_SHOWN = 10;

type CategoryCounts = { total: number, created: number, updated: number, deleted: number };

/** @internal Exported for tests, not part of the module's API. */
export type PreviewCounts = Map<number, CategoryCounts>;

/**
 * The per-category `+N ~N −N` line and the destructive callout are the point of this screen:
 * everything after it either confirms or backs out, so the damage has to be legible *here*. The
 * same counts also feed the dropdown option descriptions, but a closed dropdown shows nothing.
 *
 * @internal Exported for tests, not part of the module's API.
 */
export function RenderPreviewBreakdown(actions: RestoreAction[], counts: PreviewCounts, mask: number): string {
	if (actions.length === 0) return '';

	const lines: string[] = [];

	for (const key of PLANNED_CATEGORIES) {
		const bit = RESTORE_OPTIONS[key];
		if (!(mask & bit)) continue;

		const entry = counts.get(bit);
		if (!entry || entry.total === 0) continue;

		lines.push(`${RESTORE_OPTION_NAMES[bit]} \`${DIFF_CHANGE_PREFIX[DIFF_CHANGE_TYPE.CREATE]}${entry.created} ${DIFF_CHANGE_PREFIX[DIFF_CHANGE_TYPE.UPDATE]}${entry.updated} ${DIFF_CHANGE_PREFIX[DIFF_CHANGE_TYPE.DELETE]}${entry.deleted}\``);
	}

	const destructive = actions.filter(action => action.change_type === DIFF_CHANGE_TYPE.DELETE);
	if (destructive.length > 0) {
		const named = destructive.slice(0, MAX_DESTRUCTIVE_NAMED).map(action => action.label);
		const remaining = destructive.length - named.length;
		const list = remaining > 0 ? `${named.join(', ')}, and ${remaining} more` : named.join(', ');

		lines.push('');
		lines.push(`🚩 **${destructive.length} destructive action${destructive.length === 1 ? '' : 's'}** - these are deleted, not archived`);
		lines.push(list);

		if (destructive.some(action => action.category === RESTORE_OPTIONS.CHANNELS)) {
			lines.push('Deleting a channel takes its saved message history with it.');
		}
	}

	return lines.length > 0 ? `\n\n${lines.join('\n')}` : '';
}

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.RESTORE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : true,
	customID      : 'restore-preview',
	execute       : async function(interaction, client, args) {
		const [id, maskArg] = args;
		const mask = parseInt(maskArg) || 0;

		const importedSnapshots = GetImportsForGuild(interaction.guildId!);
		const snapshotData = importedSnapshots.get(id) ?? await GetSnapshot(parseInt(id));
		if (!snapshotData) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'Snapshot Not Found',
					description: `Snapshot not found or already deleted\nCreate one using \`/snapshot create\``
				}]
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

		const categoryCounts: PreviewCounts = new Map();
		for (const action of plan.actions) {
			const entry = categoryCounts.get(action.category) ?? { total: 0, created: 0, updated: 0, deleted: 0 };
			entry.total++;
			if (action.change_type === DIFF_CHANGE_TYPE.CREATE) entry.created++;
			if (action.change_type === DIFF_CHANGE_TYPE.UPDATE) entry.updated++;
			if (action.change_type === DIFF_CHANGE_TYPE.DELETE) entry.deleted++;
			categoryCounts.set(action.category, entry);
		}

		const dropdownOptions: DiscordStringSelectOption[] = [];
		for (const key of PLANNED_CATEGORIES) {
			const bit = RESTORE_OPTIONS[key];
			if (!(mask & bit)) continue;

			const counts = categoryCounts.get(bit);
			if (!counts || counts.total === 0) continue;

			dropdownOptions.push({
				label: RESTORE_OPTION_NAMES[bit],
				value: String(bit),
				description: `${counts.total} action${counts.total === 1 ? '' : 's'} · ${counts.deleted} destructive`
			});
		}

		const totalActions = plan.actions.length;
		const totalDestructive = plan.actions.filter(action => action.change_type === DIFF_CHANGE_TYPE.DELETE).length;

		let description = totalActions === 0
			? 'Nothing to restore for this scope - the server already matches.'
			: `**${totalActions}** action${totalActions === 1 ? '' : 's'} would be applied${totalDestructive > 0 ? ` (**${totalDestructive}** destructive)` : ''}.`;

		description += RenderPreviewBreakdown(plan.actions, categoryCounts, mask);

		if (plan.warnings.length > 0) {
			// One hierarchy warning is emitted per role at or above the bot, so a server that placed
			// the bot low holds dozens - enough on its own to push the description past Discord's
			// 4096 character embed limit and fail the whole screen
			const shown = plan.warnings.slice(0, MAX_WARNINGS_SHOWN);
			const remaining = plan.warnings.length - shown.length;

			description += `\n\n${EMOJI.WARNING} **Warnings**\n` + shown.map(warning => `- ${warning}`).join('\n');
			if (remaining > 0) description += `\n- ...and ${remaining} more warning${remaining === 1 ? '' : 's'}`;
		}

		const buttons: (DiscordActionRow<DiscordButton> | DiscordActionRow<DiscordStringSelect>)[] = [];

		if (dropdownOptions.length > 0) {
			buttons.push({
				type: 1,
				components: [{
					type: 3,
					custom_id: `restore-category_${id}_${mask}`,
					options: dropdownOptions
				}]
			});
		}

		buttons.push({
			type: 1,
			components: [
				{
					type: 2,
					style: DiscordButtonStyle.SECONDARY,
					label: 'Download Plan',
					emoji: { name: EMOJI.EXPORT },
					custom_id: `restore-plan_${id}_${mask}`,
					disabled: totalActions === 0,
				},
				{
					// The only place a restore can be started from - the action list screen is
					// read-only by design, so there is exactly one door
					type: 2,
					style: DiscordButtonStyle.DANGER,
					label: totalActions === 0
						? 'Nothing to restore'
						: `Restore - ${totalActions} action${totalActions === 1 ? '' : 's'}`,
					emoji: { name: EMOJI.RESTORE },
					custom_id: `restore-confirm_${id}_${mask}`,
					disabled: totalActions === 0,
				}
			]
		});

		return {
			embeds: [{
				color: COLOR.PRIMARY,
				title: 'Restore Preview',
				description: description
			}],
			components: buttons
		}
	}
} satisfies ButtonHandler as ButtonHandler;