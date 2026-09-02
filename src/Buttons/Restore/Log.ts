import { ButtonHandler } from "../../Typings/HandlerTypes.js";
import {
	COLOR,
	DIFF_CHANGE_PREFIX,
	RESTORE_OPTIONS,
	RESTORE_RESULT,
	RESTORE_STATUS_NAMES
} from "../../Utils/Constants.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES, SnapshotRestore, SnapshotRestoreAction } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";
import { GetRestoreActions, GetRestoreRun } from "../../CRUD/SnapshotRestores.js";
import { RunLabel } from "../../Services/RestoreRunner.js";
import { DescribeFailureGroup, GroupFailures } from "../../Utils/Snapshots/RestoreFailures.js";
import { UploadCDN } from "../../Utils/UploadCDN.js";

// The glyphs come from `DIFF_CHANGE_PREFIX`, shared with screens 04 and 05, so the log reads like
// the preview the admin already approved and the two cannot drift apart

const RESULT_NAMES: Record<number, string> = {
	[RESTORE_RESULT.PENDING]: 'PENDING',
	[RESTORE_RESULT.OK     ]: 'OK',
	[RESTORE_RESULT.FAILED ]: 'FAILED',
	[RESTORE_RESULT.SKIPPED]: 'SKIPPED',
};

/** Plain names rather than `RESTORE_OPTION_NAMES`, which carries emoji meant for embeds */
const CATEGORY_NAMES: Record<number, string> = {
	[RESTORE_OPTIONS.CHANNELS]: 'CHANNEL',
	[RESTORE_OPTIONS.ROLES   ]: 'ROLE',
	[RESTORE_OPTIONS.BANS    ]: 'BAN',
	[RESTORE_OPTIONS.MESSAGES]: 'MESSAGE',
};

function Timestamp(value: bigint | null): string {
	return value === null ? '-' : new Date(Number(value)).toISOString();
}

function RenderAction(action: SnapshotRestoreAction): string {
	const seq = String(action.seq).padStart(4);
	const result = (RESULT_NAMES[action.result] ?? 'UNKNOWN').padEnd(7);
	const category = (CATEGORY_NAMES[action.category] ?? 'UNKNOWN').padEnd(7);

	let line = `${seq}  ${result}  ${DIFF_CHANGE_PREFIX[action.change_type] ?? '?'} ${category}  ${action.label}`;

	// The new snowflake matters: it is why the next snapshot will look like churn, and it is what
	// a retry remaps parent IDs and overwrites through
	if (action.new_id !== null) line += `  ->  ${action.new_id}`;
	if (action.error) line += `  ::  ${action.error}`;

	return line;
}

function RenderLog(record: SnapshotRestore, actions: SnapshotRestoreAction[], guildName: string): string {
	const groups = GroupFailures(actions);

	const header = [
		`Restore #${record.id} - ${RunLabel(record)}`,
		`Server        ${guildName} (${record.guild_id})`,
		`Started by    ${record.user_id}`,
		`Started       ${Timestamp(record.started_at)}`,
		`Finished      ${Timestamp(record.finished_at)}`,
		`Status        ${RESTORE_STATUS_NAMES[record.status] ?? record.status}`,
		`Applied       ${record.applied_actions} / ${record.total_actions}`,
		`Safety        ${record.safety_snapshot_id === null ? 'none - no snapshot was taken before this ran' : `Snapshot #${record.safety_snapshot_id}`}`,
	];

	const failures = groups.length === 0 ? [] : [
		'',
		'FAILURES BY CAUSE',
		...groups.map(group => `  ${DescribeFailureGroup(group)}`)
	];

	return [
		...header,
		...failures,
		'',
		'ACTIONS',
		' SEQ  RESULT   CHANGE     TARGET',
		...actions.map(RenderAction),
		''
	].join('\n');
}

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.RESTORE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	// Deliberately not 'update': this button lives on the public step log message that the runner
	// owns and re-renders on a timer, so replying keeps the two from fighting over it
	response_type : 'reply',
	hidden        : true,
	customID      : 'restore-log',
	execute       : async function(interaction, client, args) {
		const restoreID = parseInt(args[0]);
		const record = await GetRestoreRun(restoreID);

		// `GetRestoreRun` looks up by ID alone, so the guild check happens here - a run ID is
		// guessable and its log names every channel and role in the server
		if (!record || String(record.guild_id) !== interaction.guildId) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'Restore Not Found',
					description: 'That restore does not exist, or it belongs to a different server.'
				}]
			}
		}

		const actions = await GetRestoreActions(restoreID);
		const log = RenderLog(record, actions, interaction.guild!.name);
		const lookup = await UploadCDN(`restore-log-${restoreID}.txt`, Buffer.from(log, 'utf8'), 1); // 1 url = 1 download

		return {
			embeds: [{
				color: COLOR.PRIMARY,
				title: `Restore #${restoreID} Log`,
				description: `
**Download Link:** [Click here to download](https://cdn.notfbi.dev/download/${lookup})
**File Size:** ${(log.length / 1024).toFixed(2)} KB
**Actions:** ${actions.length}`
			}],
			components: [{
				type: 1,
				components: [{
					type: 2,
					style: 5,
					label: 'Download',
					url: `https://cdn.notfbi.dev/download/${lookup}`,
					emoji: { name: '📥' }
				}]
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;