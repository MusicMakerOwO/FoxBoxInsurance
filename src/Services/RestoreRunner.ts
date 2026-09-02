import { DiscordAPIError, Guild, GuildChannelCreateOptions, GuildChannelEditOptions, OverwriteResolvable, RolePosition } from "discord.js";
import { APIEmbed } from "discord-api-types/v10";
import {
	FinishRestoreRun,
	GetRestoreActions,
	GetRestoreRun,
	ListRunningRestores,
	MarkRunningRestoresInterrupted,
	RecordActionResult,
	SkipRestoreActions
} from "../CRUD/SnapshotRestores.js";
import { GetGuild, SaveGuild } from "../CRUD/Guilds.js";
import { InvalidateRestorePlans } from "./RestorePlans.js";
import { DescribeError, DescribeFailureGroup, GroupFailures } from "../Utils/Snapshots/RestoreFailures.js";
import {
	SnapshotChannel,
	SnapshotRestore,
	SnapshotRestoreAction,
	SnapshotRole
} from "../Typings/DatabaseTypes.js";
import {
	COLOR,
	DIFF_CHANGE_TYPE,
	EMOJI,
	RESTORE_OPTION_NAMES,
	RESTORE_OPTIONS,
	RESTORE_RESULT,
	RESTORE_STATUS
} from "../Utils/Constants.js";
import { DiscordActionRow, DiscordButton, DiscordButtonStyle } from "../Typings/DiscordTypes.js";
import { ObjectValues } from "../Typings/HelperTypes.js";
import { client } from "../Client.js";
import { Log } from "../Utils/Log.js";

type ChannelPayload = Omit<SnapshotChannel, 'snapshot_id' | 'deleted'>;
type RolePayload    = Omit<SnapshotRole   , 'snapshot_id' | 'deleted'>;

/** @internal - exported for tests, not part of the module's API */
export type CategoryProgress = {
	total  : number,
	done   : number,
	created: number,
	updated: number,
	deleted: number,
	failed : number,
	/** Nothing to do, or never ran because the run was stopped - counted separately from failures */
	skipped: number,
}

/** @internal - exported for tests, not part of the module's API */
export type RestoreRun = {
	restore_id        : SnapshotRestore['id'],
	guild_id          : Guild['id'],
	channel_id        : string,
	message_id        : string | null,
	safety_snapshot_id: number | null,
	label             : string,
	started_by        : string,
	started_at        : number,

	total  : number,
	applied: number,
	failed : number,
	skipped: number,

	/**
	 * Every action of the run, kept in step with what is persisted as the loop records results.
	 * Screen 09 groups its failures out of this rather than re-reading them back.
	 */
	actions : SnapshotRestoreAction[],

	progress: Map<ObjectValues<typeof RESTORE_OPTIONS>, CategoryProgress>,
	/** Things that happened outside the action list, e.g. the role reposition pass failing */
	notes   : string[],

	stop_requested: boolean,
	finished      : boolean,

	/**
	 * Shutdown gave up waiting for this run. The client and the pool are about to be destroyed out
	 * from under it, so it must not touch either again - no result writes, no log edits, and no
	 * `FinishRestoreRun`. The row is deliberately left RUNNING for startup to reconcile.
	 */
	detached: boolean,

	/** Resolves when the loop has fully settled - awaited by `StopActiveRestores` on shutdown */
	settled: Promise<void>,
}

/** Failure causes shown on screen 09 before the rest are rolled into an overflow line */
const MAX_FAILURE_GROUPS = 6;

/** How often the step log message is re-rendered. Per action would hit the edit ratelimit */
const LOG_EDIT_INTERVAL = 2000;
/** How long shutdown waits for in-flight runs before giving up and letting startup reconcile them */
const SHUTDOWN_GRACE = 15_000;

/** The order categories are applied and displayed in */
const CATEGORY_ORDER = [ RESTORE_OPTIONS.ROLES, RESTORE_OPTIONS.CHANNELS, RESTORE_OPTIONS.BANS ] as const;

/**
 * Guilds with a restore in flight. This set **is** the concurrency lock - the bot is a single
 * process, so the `SnapshotRestores` rows exist for durability and restart reporting, not for
 * mutual exclusion.
 */
const restoringGuilds = new Set<Guild['id']>();
const activeRuns = new Map<SnapshotRestore['id'], RestoreRun>();

/**
 * Runs asked to stop before they finished registering themselves in `activeRuns`.
 *
 * The lock is claimed by the handler, but the run object only exists several awaits later inside
 * `StartRun` - without this, a Stop press or a shutdown landing in that window is silently dropped
 * and the run carries on. Held per guild and dropped with that guild's lock, since the lock is what
 * authorises the request; within a guild it is keyed on the run, so a click on an older run's log
 * cannot stop whichever run happens to be starting.
 */
const pendingStops = new Map<Guild['id'], Set<SnapshotRestore['id']>>();

/**
 * Set once `StopActiveRestores` runs. A run still loading at that point has no `stop_requested` flag
 * to set and no `settled` promise to wait on, so it checks this and stops before its first action.
 */
let shuttingDown = false;

export function IsRestoreRunning(guildID: Guild['id']): boolean {
	return restoringGuilds.has(guildID);
}

/**
 * Reserves the guild for a restore. Synchronous on purpose: it must be callable between a check
 * and the first `await` so two clicks landing together cannot both get through.
 *
 * @returns false if a restore is already running for this guild
 */
export function ClaimRestoreLock(guildID: Guild['id']): boolean {
	if (restoringGuilds.has(guildID)) return false;
	restoringGuilds.add(guildID);
	return true;
}

export function ReleaseRestoreLock(guildID: Guild['id']): void {
	restoringGuilds.delete(guildID);

	// A stop intent must not outlive the lock that authorised it. A stale click on a run that never
	// starts would otherwise sit here for the life of the process and stop that run's *next* attempt
	// - a retry pressed hours later would skip every action without making a single call
	pendingStops.delete(guildID);
}

/** @returns false if there is no such run in this guild, or it has already finished */
export function RequestStop(restoreID: SnapshotRestore['id'], guildID: Guild['id']): boolean {
	const run = activeRuns.get(restoreID);

	// The run is locked but still starting up, so there is nothing to set the flag on yet. Record the
	// intent and let `StartRun` pick it up rather than telling the admin there is nothing to stop.
	// The guild lock is what authorises this - `restoreID` is only matched, never trusted.
	if (!run) {
		if (!restoringGuilds.has(guildID)) return false;

		const pending = pendingStops.get(guildID) ?? new Set<SnapshotRestore['id']>();
		pending.add(restoreID);
		pendingStops.set(guildID, pending);
		return true;
	}

	if (run.guild_id !== guildID || run.finished) return false;

	run.stop_requested = true;
	return true;
}

//////////////////
// Applying actions
//////////////////

/**
 * Recreated roles and categories get brand new snowflakes, so anything in the snapshot that points
 * at an old ID has to be rewritten before it is sent to Discord.
 *
 * @internal Exported for tests, not part of the module's API.
 */
export type IDRemap = Map<bigint, bigint>;

function Remap(remap: IDRemap, id: bigint): bigint {
	return remap.get(id) ?? id;
}

/** @internal Exported for tests, not part of the module's API. */
export function BuildOverwrites(guild: Guild, remap: IDRemap, raw: ChannelPayload['permission_overwrites']): OverwriteResolvable[] {
	const overwrites: OverwriteResolvable[] = [];

	for (const [rawID, overwrite] of Object.entries(raw)) {
		const id = String(Remap(remap, BigInt(rawID)));

		// Discord rejects overwrites keyed on a role it cannot find. User overwrites are passed
		// through untouched - the member cache is not complete enough to filter on
		if (overwrite.type === 0 && !guild.roles.cache.has(id)) continue;

		overwrites.push({
			id,
			allow: BigInt(overwrite.allow),
			deny : BigInt(overwrite.deny),
			type : overwrite.type
		});
	}

	return overwrites;
}

type ActionOutcome = { result: ObjectValues<typeof RESTORE_RESULT>, newID?: bigint, error?: string };

const SKIPPED = (reason: string): ActionOutcome => ({ result: RESTORE_RESULT.SKIPPED, error: reason });

/** @internal Exported for tests, not part of the module's API. */
export async function ApplyRoleAction(guild: Guild, action: SnapshotRestoreAction, remap: IDRemap, reason: string): Promise<ActionOutcome> {
	if (action.change_type === DIFF_CHANGE_TYPE.CREATE) {
		const payload = action.payload as RolePayload;
		// Position is deliberately omitted - it is applied in one pass once every role exists,
		// since per-role position edits fight each other and trip the hierarchy check
		const created = await guild.roles.create({
			name       : payload.name,
			color      : payload.color,
			hoist      : Boolean(payload.hoist),
			permissions: payload.permissions,
			reason
		});

		remap.set(action.target_id, BigInt(created.id));
		return { result: RESTORE_RESULT.OK, newID: BigInt(created.id) };
	}

	const role = guild.roles.cache.get(String(action.target_id));
	if (!role) return SKIPPED('role no longer exists');

	if (action.change_type === DIFF_CHANGE_TYPE.DELETE) {
		await role.delete(reason);
		return { result: RESTORE_RESULT.OK };
	}

	const payload = action.payload as RolePayload;

	// `@everyone` has no name, colour, hoist or position of its own - Discord rejects all of them.
	// Its permissions are the whole point of restoring it, so send only those
	if (action.target_id === BigInt(guild.id)) {
		await role.edit({ permissions: payload.permissions, reason });
		return { result: RESTORE_RESULT.OK };
	}

	await role.edit({
		name       : payload.name,
		color      : payload.color,
		hoist      : Boolean(payload.hoist),
		permissions: payload.permissions,
		reason
	});
	return { result: RESTORE_RESULT.OK };
}

/** @internal Exported for tests, not part of the module's API. */
export async function ApplyChannelAction(guild: Guild, action: SnapshotRestoreAction, remap: IDRemap, reason: string): Promise<ActionOutcome> {
	if (action.change_type === DIFF_CHANGE_TYPE.DELETE) {
		const channel = guild.channels.cache.get(String(action.target_id));
		if (!channel) return SKIPPED('channel no longer exists');

		await channel.delete(reason);
		return { result: RESTORE_RESULT.OK };
	}

	const payload = action.payload as ChannelPayload;
	const parentID = payload.parent_id === null ? null : String(Remap(remap, payload.parent_id));
	const overwrites = BuildOverwrites(guild, remap, payload.permission_overwrites);

	// The category this channel belongs under never made it. Creating it at the server root anyway
	// and reporting OK is unrecoverable - the row is not FAILED, so a retry never revisits it, and
	// re-parenting afterwards costs another write per channel. Skipping leaves one retryable
	// category failure to fix instead
	const parentMissing = parentID !== null && !guild.channels.cache.has(parentID);

	if (action.change_type === DIFF_CHANGE_TYPE.CREATE) {
		if (parentMissing) return SKIPPED('parent category was not created');

		const options = {
			name                : payload.name,
			type                : payload.type,
			position            : payload.position,
			permissionOverwrites: overwrites,
			reason
		} as GuildChannelCreateOptions;

		// Only set fields the snapshot actually holds - a category rejects `topic`, and every
		// channel type rejects fields it does not support
		if (parentID) options.parent = parentID;
		if (payload.topic) options.topic = payload.topic;
		if (payload.nsfw) options.nsfw = true;

		const created = await guild.channels.create(options);
		remap.set(action.target_id, BigInt(created.id));
		return { result: RESTORE_RESULT.OK, newID: BigInt(created.id) };
	}

	const channel = guild.channels.cache.get(String(action.target_id));
	if (!channel) return SKIPPED('channel no longer exists');
	if (parentMissing) return SKIPPED('parent category was not created');

	const options: GuildChannelEditOptions = {
		name                : payload.name,
		position            : payload.position,
		permissionOverwrites: overwrites,
		parent              : parentID,
		reason
	};
	if (payload.topic) options.topic = payload.topic;
	if (payload.nsfw) options.nsfw = true;

	await channel.edit(options);
	return { result: RESTORE_RESULT.OK };
}

/** @internal Exported for tests, not part of the module's API. */
export async function ApplyBanAction(guild: Guild, action: SnapshotRestoreAction, reason: string): Promise<ActionOutcome> {
	const userID = String(action.target_id);

	if (action.change_type === DIFF_CHANGE_TYPE.DELETE) {
		try {
			await guild.bans.remove(userID, reason);
		} catch (error) {
			// Already unbanned by someone else - the desired end state, not a failure. Recording
			// it as one would leave a row that retry could never clear
			if (error instanceof DiscordAPIError && error.code === 10026) return SKIPPED('user is not banned');
			throw error;
		}

		return { result: RESTORE_RESULT.OK };
	}

	// Ban reasons cannot be edited, so the planner never emits ban updates - only that the user
	// should be banned, which this is idempotent about
	await guild.bans.create(userID, { reason });
	return { result: RESTORE_RESULT.OK };
}

/**
 * Applies every role position in one call, after all role work is done.
 *
 * Snapshot positions are indices into a different role list, and Discord rejects any position at
 * or above the bot's own highest role - those are dropped rather than failing the whole call.
 *
 * @internal Exported for tests, not part of the module's API.
 */
export async function RepositionRoles(guild: Guild, actions: SnapshotRestoreAction[], remap: IDRemap): Promise<string | null> {
	const botHighest = guild.members.me?.roles.highest.position ?? 0;
	const positions: RolePosition[] = [];
	let clamped = 0;

	for (const action of actions) {
		if (action.category !== RESTORE_OPTIONS.ROLES || action.change_type === DIFF_CHANGE_TYPE.DELETE) continue;

		const payload = action.payload as RolePayload | null;
		if (!payload) continue;

		const role = guild.roles.cache.get(String(Remap(remap, action.target_id)));
		// `@everyone` is pinned at position 0 and is not `managed`, so it needs its own guard - one
		// rejected entry fails the whole `setPositions` call and loses every other role's order
		if (!role || role.managed || role.id === guild.id) continue;

		if (payload.position >= botHighest) {
			clamped++;
			continue;
		}

		positions.push({ role: role.id, position: payload.position });
	}

	if (positions.length === 0) return clamped > 0 ? `Could not reorder ${clamped} role(s) - they sit above my highest role` : null;

	try {
		await guild.roles.setPositions(positions);
	} catch (error) {
		Log('ERROR', error);
		return `Could not reorder roles - ${DescribeError(error, RESTORE_OPTIONS.ROLES)}`;
	}

	return clamped > 0 ? `Reordered roles, except ${clamped} that sit above my highest role` : null;
}

//////////////////
// Step log
//////////////////

/** @internal Exported for tests, not part of the module's API. */
export function RenderProgressLines(run: RestoreRun): string[] {
	const lines: string[] = [];

	if (run.safety_snapshot_id !== null) {
		lines.push(`${EMOJI.SUCCESS} Safety snapshot #${run.safety_snapshot_id} saved`);
	}

	for (const category of CATEGORY_ORDER) {
		const progress = run.progress.get(category);
		if (!progress || progress.total === 0) continue;

		const name = RESTORE_OPTION_NAMES[category];

		if (progress.done === 0) {
			lines.push(`· ${name} - queued`);
			continue;
		}

		if (progress.done < progress.total) {
			lines.push(`${EMOJI.LOADING} ${name} - ${progress.done} / ${progress.total}`);
			continue;
		}

		const parts: string[] = [];
		if (progress.created > 0) parts.push(`${progress.created} created`);
		if (progress.updated > 0) parts.push(`${progress.updated} updated`);
		if (progress.deleted > 0) parts.push(`${progress.deleted} deleted`);
		if (progress.failed  > 0) parts.push(`${progress.failed} failed`);
		if (progress.skipped > 0) parts.push(`${progress.skipped} skipped`);

		// A stopped run leaves whole categories skipped - without them the line reads
		// "nothing to do", which is the opposite of what happened
		const icon = progress.failed > 0 ? EMOJI.WARNING : progress.skipped > 0 ? EMOJI.INFO : EMOJI.SUCCESS;

		lines.push(`${icon} ${name} - ${parts.join(', ') || 'nothing to do'}`);
	}

	return lines.concat(run.notes.map(note => `${EMOJI.INFO} ${note}`));
}

function RenderRunning(run: RestoreRun): { embeds: APIEmbed[], components: DiscordActionRow<DiscordButton>[] } {
	return {
		embeds: [{
			color: COLOR.PRIMARY,
			title: `${EMOJI.RESTORE} Restoring ${run.label}`,
			description: RenderProgressLines(run).join('\n') || `${EMOJI.LOADING} Starting...`,
			footer: { text: `Started by ${run.started_by} · ${run.applied + run.failed + run.skipped} / ${run.total} actions · do not delete this message` }
		}],
		components: [{
			type: 1,
			components: [{
				type: 2,
				style: DiscordButtonStyle.DANGER,
				label: run.stop_requested ? 'Stopping...' : 'Stop',
				emoji: { name: EMOJI.STOP },
				custom_id: `restore-stop_${run.restore_id}`,
				disabled: run.stop_requested
			}]
		}]
	};
}

/**
 * One line per *cause*, not per entity.
 *
 * Nine roles that all sit above the bot are one problem with one fix; listing them individually
 * buries that. The overflow tail exists because this embed shares a 4096 character description
 * with the progress lines - the full detail is in the downloadable log.
 */
function RenderFailureLines(run: RestoreRun): string {
	if (run.failed === 0) return '';

	const groups = GroupFailures(run.actions);
	const shown = groups.slice(0, MAX_FAILURE_GROUPS);
	const hidden = groups.length - shown.length;

	const lines = shown.map(group => `${EMOJI.WARNING} ${DescribeFailureGroup(group)}`);
	if (hidden > 0) lines.push(`${EMOJI.INFO} ...and ${hidden} more cause${hidden === 1 ? '' : 's'} - download the log for the full list.`);

	return `${lines.join('\n')}\n\n`;
}

/** @internal Exported for tests, not part of the module's API. */
export function RenderFinished(run: RestoreRun, status: ObjectValues<typeof RESTORE_STATUS>): { embeds: APIEmbed[], components: DiscordActionRow<DiscordButton>[] } {
	const elapsed = Math.round((Date.now() - run.started_at) / 1000);
	const duration = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`;

	const title = status === RESTORE_STATUS.COMPLETE ? `${EMOJI.SUCCESS} Restore complete`
		: status === RESTORE_STATUS.STOPPED          ? `${EMOJI.STOP} Restore stopped`
		: status === RESTORE_STATUS.INTERRUPTED      ? `${EMOJI.ERROR} Restore interrupted`
		: `${EMOJI.ERROR} Restore finished with ${run.failed} failure${run.failed === 1 ? '' : 's'}`;

	// Retry replays failed rows only. Actions skipped because a run was stopped or killed were
	// never attempted, so there is nothing to replay - say so rather than leave admins hunting
	// for a button that will not appear
	const noRetry = `Skipped actions cannot be retried - restore ${run.label} again to pick up where this left off.`;

	const closing = status === RESTORE_STATUS.COMPLETE
		? `The server now matches ${run.label}.`
		: status === RESTORE_STATUS.STOPPED
			? `**This server is half restored.** ${run.skipped} action${run.skipped === 1 ? '' : 's'} never ran. ${noRetry}`
			: status === RESTORE_STATUS.INTERRUPTED
				? `**This server is half restored.** I was shut down partway through and did not resume - resuming a half-applied plan against a changed server is riskier than stopping here. ${noRetry}`
				: `Fix the cause and retry only the failures, or roll back.`;

	const recovery = run.safety_snapshot_id === null
		? ''
		: `\n\n${EMOJI.SNAPSHOT} Snapshot #${run.safety_snapshot_id} holds what this server looked like before the restore ran.`;

	const buttons: DiscordButton[] = [];

	if (status === RESTORE_STATUS.FAILED && run.failed > 0) {
		buttons.push({
			type: 2,
			style: DiscordButtonStyle.PRIMARY,
			label: `Retry ${run.failed} failure${run.failed === 1 ? '' : 's'}`,
			emoji: { name: EMOJI.RESTORE },
			custom_id: `restore-retry_${run.restore_id}`
		});
	}

	buttons.push({
		type: 2,
		style: DiscordButtonStyle.SECONDARY,
		label: 'Download log',
		emoji: { name: EMOJI.EXPORT },
		custom_id: `restore-log_${run.restore_id}`
	});

	if (run.safety_snapshot_id !== null) {
		// The undo path is not a button of its own - it is this same flow pointed at the snapshot
		// taken before the run, so this just opens its manage screen
		buttons.push({
			type: 2,
			style: DiscordButtonStyle.SECONDARY,
			label: `Snapshot #${run.safety_snapshot_id}`,
			emoji: { name: EMOJI.SNAPSHOT },
			custom_id: `restore-safety_${run.safety_snapshot_id}`
		});
	}

	return {
		embeds: [{
			color: status === RESTORE_STATUS.COMPLETE ? COLOR.SUCCESS : COLOR.ERROR,
			title,
			description: `
${RenderProgressLines(run).join('\n')}

**${run.applied} / ${run.total}** action${run.total === 1 ? '' : 's'} applied in ${duration}.
${RenderFailureLines(run)}${closing}${recovery}

Recreated channels and roles have new IDs, so the next snapshot of this server will show a lot of churn.`,
			footer: { text: `Started by ${run.started_by}` }
		}],
		components: [{ type: 1, components: buttons }]
	};
}

async function EditLog(run: RestoreRun, payload: { embeds: APIEmbed[], components: DiscordActionRow<DiscordButton>[] }): Promise<void> {
	// A tick can already be scheduled when shutdown detaches the run - the client it would edit
	// through is being destroyed
	if (!run.message_id || run.detached) return;

	const channel = client.channels.cache.get(run.channel_id);
	if (!channel?.isSendable()) return;

	await channel.messages.edit(run.message_id, payload).catch(error => {
		// A deleted step log should not take the restore down with it
		Log('ERROR', error);
		run.message_id = null;
	});
}

//////////////////
// The run
//////////////////

/** How a run refers to its source, e.g. "Snapshot #143" or "Import #1234-5678-9012-3456" */
export function RunLabel(record: SnapshotRestore): string {
	return record.snapshot_id === null ? `Import #${record.import_id}` : `Snapshot #${record.snapshot_id}`;
}

/**
 * Builds the per-category counters from what is already persisted.
 *
 * A first run's rows are all PENDING, so this zeroes for it naturally - the same function seeds a
 * retry (which must show the whole run, not just the slice being re-applied) and the interrupted
 * runs rebuilt at startup.
 *
 * @internal Exported for tests, not part of the module's API.
 */
export function SeedProgress(actions: SnapshotRestoreAction[]): Map<ObjectValues<typeof RESTORE_OPTIONS>, CategoryProgress> {
	const progress = new Map<ObjectValues<typeof RESTORE_OPTIONS>, CategoryProgress>();

	for (const category of CATEGORY_ORDER) {
		const inCategory = actions.filter(action => action.category === category);
		const applied = inCategory.filter(action => action.result === RESTORE_RESULT.OK);

		progress.set(category, {
			total  : inCategory.length,
			done   : inCategory.filter(action => action.result !== RESTORE_RESULT.PENDING).length,
			created: applied.filter(action => action.change_type === DIFF_CHANGE_TYPE.CREATE).length,
			updated: applied.filter(action => action.change_type === DIFF_CHANGE_TYPE.UPDATE).length,
			deleted: applied.filter(action => action.change_type === DIFF_CHANGE_TYPE.DELETE).length,
			failed : inCategory.filter(action => action.result === RESTORE_RESULT.FAILED).length,
			skipped: inCategory.filter(action => action.result === RESTORE_RESULT.SKIPPED).length,
		});
	}

	return progress;
}

/**
 * Assembles the in-memory view of a run, with every counter seeded from its persisted actions
 *
 * @internal Exported for tests, not part of the module's API.
 */
export function BuildRun(record: SnapshotRestore, actions: SnapshotRestoreAction[], startedBy: string, settled: Promise<void>): RestoreRun {
	return {
		restore_id        : record.id,
		guild_id          : String(record.guild_id),
		channel_id        : String(record.channel_id),
		message_id        : record.message_id === null ? null : String(record.message_id),
		safety_snapshot_id: record.safety_snapshot_id,
		label             : RunLabel(record),
		started_by        : startedBy,
		started_at        : Number(record.started_at),

		total  : actions.length,
		applied: actions.filter(action => action.result === RESTORE_RESULT.OK).length,
		failed : actions.filter(action => action.result === RESTORE_RESULT.FAILED).length,
		skipped: actions.filter(action => action.result === RESTORE_RESULT.SKIPPED).length,

		actions,
		progress: SeedProgress(actions),
		notes   : [],

		stop_requested: false,
		finished      : false,
		detached      : false,
		settled
	};
}

/**
 * Rebuilds the old ID -> new ID map from the `new_id` column.
 *
 * A retry starts with an empty remap, but the categories and roles its actions reference were
 * recreated by the original run and carry new snowflakes. Without this a retried channel create
 * would be sent a `parent_id` that no longer exists - which is the whole reason `new_id` is
 * persisted per action rather than living only in the runner's memory.
 *
 * @internal Exported for tests, not part of the module's API.
 */
export function RehydrateRemap(actions: SnapshotRestoreAction[]): IDRemap {
	const remap: IDRemap = new Map();

	for (const action of actions) {
		if (action.new_id !== null) remap.set(action.target_id, action.new_id);
	}

	return remap;
}

/**
 * Moves one action between result buckets, `delta` of +1 to enter a bucket and -1 to leave it.
 *
 * Retry re-applies rows that already counted as failures, so every update has to be a transition
 * out of the previous result rather than a fresh increment - otherwise a retried failure that
 * succeeds would be counted as both. PENDING occupies no bucket, which is what lets a first run
 * take this same path.
 *
 * @internal Exported for tests, not part of the module's API.
 */
export function CountResult(
	run: RestoreRun,
	progress: CategoryProgress,
	changeType: SnapshotRestoreAction['change_type'],
	result: ObjectValues<typeof RESTORE_RESULT>,
	delta: 1 | -1
): void {
	if (result === RESTORE_RESULT.PENDING) return;

	progress.done += delta;

	if (result === RESTORE_RESULT.OK) {
		run.applied += delta;

		if (changeType === DIFF_CHANGE_TYPE.CREATE) progress.created += delta;
		else if (changeType === DIFF_CHANGE_TYPE.UPDATE) progress.updated += delta;
		else progress.deleted += delta;

		return;
	}

	if (result === RESTORE_RESULT.FAILED) {
		run.failed += delta;
		progress.failed += delta;
		return;
	}

	run.skipped += delta;
	progress.skipped += delta;
}

/** What a stopped run records against the actions it never got to */
const STOP_REASON = 'stopped before this action ran';

/**
 * Marks everything a stopped run did not reach as SKIPPED, in memory and in one write.
 *
 * The in-memory half comes first and is never skipped, so the completion embed is right even if the
 * write is not: a run that is stopping is usually stopping because the process is going away, and
 * either the pool is already gone (`detached`) or it is about to be.
 */
async function SkipRemaining(run: RestoreRun, remaining: SnapshotRestoreAction[]): Promise<void> {
	for (const action of remaining) {
		const progress = run.progress.get(action.category)!;

		CountResult(run, progress, action.change_type, action.result, -1);
		CountResult(run, progress, action.change_type, RESTORE_RESULT.SKIPPED, 1);

		// `remaining` holds the same objects as `allActions`, so keeping them in step keeps that
		// array a live view of the run for anything rendering from it
		action.result = RESTORE_RESULT.SKIPPED;
		action.error = STOP_REASON;
	}

	if (run.detached || remaining.length === 0) return;

	await SkipRestoreActions(run.restore_id, remaining.map(action => action.seq), STOP_REASON)
		.catch(Log.bind(null, 'ERROR'));
}

/**
 * Applies `toApply` in `seq` order and drives the public step log message.
 *
 * `allActions` is the full run - the counters, the log and the role reposition pass all describe
 * the whole restore even when only a failed slice is being re-applied.
 *
 * @internal Exported for tests, not part of the module's API.
 */
export async function ExecuteRun(
	guild: Guild,
	record: SnapshotRestore,
	run: RestoreRun,
	toApply: SnapshotRestoreAction[],
	allActions: SnapshotRestoreAction[],
	isRetry: boolean
): Promise<void> {
	activeRuns.set(run.restore_id, run);

	// `flushing` keeps ticks from overlapping each other; `inFlight` is what the finally block below
	// waits on, so a tick already in the air cannot land *after* the completion embed and leave the
	// message stuck on "Restoring..." with a live Stop button forever
	let flushing = false;
	let inFlight: Promise<void> = Promise.resolve();
	const ticker = setInterval(() => {
		if (flushing) return;
		flushing = true;
		inFlight = EditLog(run, RenderRunning(run)).finally(() => { flushing = false });
	}, LOG_EDIT_INTERVAL);
	ticker.unref();

	const reason = `Restore of ${run.label} by ${run.started_by} (${record.user_id})`.slice(0, 500);
	const remap = isRetry ? RehydrateRemap(allActions) : new Map<bigint, bigint>();

	// A retry that touches no roles has no reason to reorder them - the original run already did,
	// and repeating the pass would fight whatever an admin fixed by hand in between
	let repositioned = isRetry && !toApply.some(action => action.category === RESTORE_OPTIONS.ROLES);

	try {
		for (const [index, action] of toApply.entries()) {
			const progress = run.progress.get(action.category)!;
			const previous = action.result;

			// The rest of the slice goes down in one write rather than one per action - shutdown only
			// has a few seconds, and a large plan is hundreds of round trips
			if (run.stop_requested) {
				await SkipRemaining(run, toApply.slice(index));
				break;
			}

			// Once every role exists, put them in order before anything references them
			if (!repositioned && action.category !== RESTORE_OPTIONS.ROLES) {
				repositioned = true;
				const note = await RepositionRoles(guild, allActions, remap);
				if (note) run.notes.push(note);
			}

			try {
				const outcome =
					action.category === RESTORE_OPTIONS.ROLES    ? await ApplyRoleAction(guild, action, remap, reason) :
					action.category === RESTORE_OPTIONS.CHANNELS ? await ApplyChannelAction(guild, action, remap, reason) :
						await ApplyBanAction(guild, action, reason);

				CountResult(run, progress, action.change_type, previous, -1);
				CountResult(run, progress, action.change_type, outcome.result, 1);

				if (!run.detached) await RecordActionResult(run.restore_id, action.seq, outcome.result, outcome.newID ?? null, outcome.error ?? null);

				action.result = outcome.result;
				action.new_id = outcome.newID ?? null;
				action.error = outcome.error ?? null;
			} catch (error) {
				// A failed action is recorded and the run continues - one bad role should not
				// abandon the other hundred actions the admin confirmed
				Log('ERROR', error);

				const described = DescribeError(error, action.category);

				CountResult(run, progress, action.change_type, previous, -1);
				CountResult(run, progress, action.change_type, RESTORE_RESULT.FAILED, 1);

				if (!run.detached) await RecordActionResult(run.restore_id, action.seq, RESTORE_RESULT.FAILED, null, described);

				action.result = RESTORE_RESULT.FAILED;
				action.error = described;
			}
		}

		// Every action was a role, so the reposition pass never got its trigger above
		if (!repositioned && !run.stop_requested) {
			const note = await RepositionRoles(guild, allActions, remap);
			if (note) run.notes.push(note);
		}
	} finally {
		clearInterval(ticker);

		// Set before draining, so a tick that is already rendering describes a finished run
		run.finished = true;
		await inFlight.catch(() => {});

		// Shutdown stopped waiting for this run, so the pool and the client are gone or going and it
		// closes out in memory only. Leaving the row RUNNING is the point: that is what gets it
		// reported honestly as INTERRUPTED by `ReconcileInterruptedRestores` at the next startup
		if (!run.detached) {
			const status = run.stop_requested ? RESTORE_STATUS.STOPPED
				: run.failed > 0              ? RESTORE_STATUS.FAILED
				: RESTORE_STATUS.COMPLETE;

			await FinishRestoreRun(run.restore_id, status, run.applied).catch(Log.bind(null, 'ERROR'));

			if (run.applied > 0) {
				const savedGuild = await GetGuild(run.guild_id).catch(() => null);
				if (savedGuild) {
					// SaveGuild only writes last_restore through the SimpleGuild branch
					savedGuild.last_restore = BigInt(Date.now());
					await SaveGuild(savedGuild).catch(Log.bind(null, 'ERROR'));
				}
			}

			await EditLog(run, RenderFinished(run, status));
		}

		// Every cached plan for this guild is stale now - the server it was diffed against is gone
		InvalidateRestorePlans(run.guild_id);
		activeRuns.delete(run.restore_id);
	}
}

/** Loads a persisted run, applies the requested slice of it, and always releases the guild lock */
async function StartRun(restoreID: SnapshotRestore['id'], guildID: Guild['id'], isRetry: boolean): Promise<void> {
	let settle: () => void = () => {};
	const settled = new Promise<void>(resolve => { settle = resolve });

	try {
		const record = await GetRestoreRun(restoreID);
		const guild = client.guilds.cache.get(guildID);
		if (!record || !guild) throw new Error(`Restore #${restoreID} has no run row or guild`);

		const actions = await GetRestoreActions(restoreID);
		const toApply = isRetry ? actions.filter(action => action.result === RESTORE_RESULT.FAILED) : actions;

		const user = await client.users.fetch(String(record.user_id)).catch(() => null);
		const run = BuildRun(record, actions, user?.tag ?? `<@${record.user_id}>`, settled);

		// Someone pressed Stop, or the bot began shutting down, while this run was still loading
		if (shuttingDown || pendingStops.get(guildID)?.delete(restoreID)) run.stop_requested = true;

		if (isRetry) run.notes.push(`Retrying ${toApply.length} failed action${toApply.length === 1 ? '' : 's'}`);

		await ExecuteRun(guild, record, run, toApply, actions, isRetry);
	} finally {
		// Also drops any stop intent recorded against this guild, including one for a run that never
		// started - see `ReleaseRestoreLock`
		ReleaseRestoreLock(guildID);
		settle();
	}
}

/** Applies every action of a run in `seq` order and drives its public step log message */
export async function RunRestore(restoreID: SnapshotRestore['id'], guildID: Guild['id']): Promise<void> {
	await StartRun(restoreID, guildID, false);
}

/**
 * Re-applies only the actions that failed, replaying their persisted payloads.
 *
 * There is no modal and no plan rebuild: these are byte for byte the actions the admin already
 * confirmed. Rebuilding would diff against the server as it is *now* and could surface actions
 * nobody approved. Callers must claim the guild lock and reopen the run row first.
 */
export async function RetryRestore(restoreID: SnapshotRestore['id'], guildID: Guild['id']): Promise<void> {
	await StartRun(restoreID, guildID, true);
}

/**
 * A run still marked RUNNING at startup was killed mid-restore. There is no resume: replaying a
 * half-applied plan against a server that has since changed is a worse failure mode than saying so.
 */
export async function ReconcileInterruptedRestores(): Promise<void> {
	const runs = await ListRunningRestores();
	if (runs.length === 0) return;

	await MarkRunningRestoresInterrupted();

	for (const record of runs) {
		const actions = await GetRestoreActions(record.id);
		const run = BuildRun(record, actions, `<@${record.user_id}>`, Promise.resolve());
		run.finished = true;

		await EditLog(run, RenderFinished(run, RESTORE_STATUS.INTERRUPTED));
		Log('WARN', `Restore #${record.id} was interrupted by a restart and will not be resumed`);
	}
}

/**
 * Asks every in-flight run to stop and waits for them to settle, so the final log edit goes out
 * while the client is still connected. Must run before `client.destroy()`.
 */
export async function StopActiveRestores(): Promise<void> {
	// A run that has claimed the lock but not yet reached `activeRuns` is still a run in flight, and
	// there is no run object to flag yet - it reads this when `StartRun` builds one
	shuttingDown = true;

	const runs = Array.from(activeRuns.values());
	if (runs.length === 0) return;

	for (const run of runs) run.stop_requested = true;

	const timedOut = await Promise.race([
		Promise.all(runs.map(run => run.settled)).then(() => false),
		new Promise<boolean>(resolve => setTimeout(() => resolve(true), SHUTDOWN_GRACE).unref())
	]);

	if (!timedOut) return;

	// The caller destroys the client and the pool the moment this resolves, so a run still going here
	// is cut loose rather than left writing into either. It stays RUNNING and the next startup
	// reconciles it as INTERRUPTED - the same outcome as a hard kill, reported the same way
	for (const run of runs) {
		if (run.finished) continue;

		run.detached = true;
		Log('WARN', `Restore #${run.restore_id} did not stop within ${SHUTDOWN_GRACE}ms - detaching it; it will be reported as interrupted at the next startup`);
	}
}