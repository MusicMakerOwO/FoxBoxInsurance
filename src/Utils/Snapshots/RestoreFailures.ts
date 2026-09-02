import { DiscordAPIError } from "discord.js";
import { RESTORE_OPTIONS, RESTORE_RESULT } from "../Constants.js";
import { ObjectValues } from "../../Typings/HelperTypes.js";
import { SnapshotRestoreAction } from "../../Typings/DatabaseTypes.js";

type RestoreCategory = ObjectValues<typeof RESTORE_OPTIONS>;

/**
 * Discord error codes worth translating. Anything unmapped falls back to the raw message, and the
 * full error always goes to the log - these strings exist so an admin reads a cause rather than a
 * number, and so failures can be grouped by that cause.
 */
const ERROR_MESSAGES: Record<number, string> = {
	10003: 'channel no longer exists',
	10011: 'role no longer exists',
	10026: 'user is not banned',
	30005: 'role limit reached',
	30013: 'channel limit reached',
	50001: 'missing access',
	50013: 'missing permissions',
	50035: 'rejected by Discord as invalid',
};

/**
 * The same code means different things per category, and the difference is the whole point of the
 * message - "missing permissions" is not actionable, "above my highest role" is fixable in ten
 * seconds. Overrides `ERROR_MESSAGES` when both match.
 */
const CATEGORY_ERROR_MESSAGES: Partial<Record<RestoreCategory, Record<number, string>>> = {
	[RESTORE_OPTIONS.ROLES]: {
		// Discord reports hierarchy violations as a plain permission error, and hierarchy is by far
		// the more common cause - a bot that can create roles at all already holds Manage Roles
		50013: 'above my highest role',
		50001: 'above my highest role',
	},
	[RESTORE_OPTIONS.CHANNELS]: {
		50013: 'missing Manage Channels',
	},
	[RESTORE_OPTIONS.BANS]: {
		50013: 'missing Ban Members',
	},
};

/** Singular / plural nouns for a failure group, e.g. "6 roles", "1 channel" */
const CATEGORY_NOUNS: Record<RestoreCategory, [string, string]> = {
	[RESTORE_OPTIONS.CHANNELS]: [ 'channel', 'channels' ],
	[RESTORE_OPTIONS.ROLES   ]: [ 'role'   , 'roles'    ],
	[RESTORE_OPTIONS.BANS    ]: [ 'ban'    , 'bans'     ],
	[RESTORE_OPTIONS.MESSAGES]: [ 'message', 'messages' ],
};

/**
 * Normalises any thrown value into a short, stable cause.
 *
 * Stability matters as much as readability: this string is what gets persisted to
 * `SnapshotRestoreActions.error`, and `GroupFailures` groups on it verbatim. Two roles that failed
 * for the same reason must produce byte-identical strings or they will not collapse.
 */
export function DescribeError(error: unknown, category?: RestoreCategory): string {
	if (error instanceof DiscordAPIError && typeof error.code === 'number') {
		const override = category === undefined ? undefined : CATEGORY_ERROR_MESSAGES[category]?.[error.code];
		if (override) return override;

		if (ERROR_MESSAGES[error.code]) return ERROR_MESSAGES[error.code];
	}

	return error instanceof Error ? error.message : String(error);
}

export type FailureGroup = {
	category: RestoreCategory,
	/** The shared cause, as produced by `DescribeError` at record time */
	reason  : string,
	/** Labels of every action that failed this way, in `seq` order */
	labels  : string[],
}

/**
 * Collapses failed actions into one row per cause.
 *
 * Nine roles that all sit above the bot are one problem with one fix, not nine lines an admin has
 * to read before spotting that. Grouping is on `(category, error)` - `DescribeError` already
 * normalised the text when the row was written, so identical causes collide exactly.
 *
 * @returns groups sorted by size descending, so the biggest fix is read first
 */
export function GroupFailures(actions: SnapshotRestoreAction[]): FailureGroup[] {
	const groups = new Map<string, FailureGroup>();

	for (const action of actions) {
		if (action.result !== RESTORE_RESULT.FAILED) continue;

		const reason = action.error ?? 'unknown error';
		const key = `${action.category}:${reason}`;

		const group = groups.get(key);
		if (group) group.labels.push(action.label);
		else groups.set(key, { category: action.category, reason, labels: [ action.label ] });
	}

	return Array.from(groups.values()).sort((a, b) => b.labels.length - a.labels.length);
}

/** One rendered line, e.g. `6 roles - above my highest role` */
export function DescribeFailureGroup(group: FailureGroup): string {
	const [ singular, plural ] = CATEGORY_NOUNS[group.category];
	const noun = group.labels.length === 1 ? singular : plural;

	return `${group.labels.length} ${noun} - ${group.reason}`;
}