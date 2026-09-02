import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Guild } from 'discord.js';
import {
	COLOR,
	DIFF_CHANGE_TYPE,
	EMOJI,
	RESTORE_OPTIONS,
	RESTORE_RESULT,
	RESTORE_STATUS,
	SNAPSHOT_TYPE
} from '../../Utils/Constants.js';
import { SnapshotRestore, SnapshotRestoreAction } from '../../Typings/DatabaseTypes.js';
import { SnapshotLabel } from '../../Utils/Snapshots/SnapshotLabel.js';
import {
	BOT_USER_ID,
	RESTORE_NOW as NOW,
	makeJSONSnapshot,
	makeSnapshot,
	restoreAction as action,
	restoreRecord as record
} from './Fixtures.js';

// `RestoreRunner` imports the client at module scope. Nothing under test reaches `EditLog` or
// `StartRun`, so a bare stub is enough - but the import has to resolve or the whole file fails.
vi.mock('../../Client.js', () => ({
	client: { user: { id: BOT_USER_ID }, channels: { cache: new Map() }, guilds: { cache: new Map() } }
}));

// None of these helpers touch the DB. Mocked so an accidental call is a loud assertion failure
// rather than a hang against a MariaDB that may not be running.
vi.mock('../../CRUD/SnapshotRestores.js', () => ({
	FinishRestoreRun: vi.fn(), GetRestoreActions: vi.fn(), GetRestoreRun: vi.fn(),
	ListRunningRestores: vi.fn(), MarkRunningRestoresInterrupted: vi.fn(), RecordActionResult: vi.fn(),
	SkipRestoreActions: vi.fn()
}));
vi.mock('../../CRUD/Guilds.js', () => ({ GetGuild: vi.fn(), SaveGuild: vi.fn() }));

// `Log` writes nothing under vitest, so the reposition failure path needs the call itself as the
// observable - same seam as `BuildRestorePlan.test.ts`
const { LogSpy } = vi.hoisted(() => ({ LogSpy: vi.fn() }));
vi.mock('../../Utils/Log.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../Utils/Log.js')>()),
	Log: LogSpy
}));

const {
	BuildRun, CountResult, RehydrateRemap, RenderFinished, RenderProgressLines,
	RepositionRoles, RunLabel, SeedProgress
} = await import('../../Services/RestoreRunner.js');

type RestoreRun = ReturnType<typeof BuildRun>;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	LogSpy.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
});

//////////////////
// Fixtures
//////////////////

/** Built through the real `BuildRun`, so every test seeds counters the way a live run does */
function run(actions: SnapshotRestoreAction[], overrides: Partial<SnapshotRestore> = {}): RestoreRun {
	return BuildRun(record(overrides), actions, 'admin#0001', Promise.resolve());
}

type LiveRole = { id: string, managed: boolean };

/**
 * A `Guild` as `RepositionRoles` reads it. Distinct from `Fixtures.makeGuild`, which has no
 * `setPositions` and caches plain snapshot fixtures rather than role-shaped objects.
 */
function makeRoleGuild(roles: LiveRole[], botHighest = 100, guildID = '1') {
	const setPositions = vi.fn().mockResolvedValue(undefined);

	const guild = {
		id     : guildID,
		members: { me: { roles: { highest: { position: botHighest } } } },
		roles  : { cache: new Map(roles.map(r => [r.id, r])), setPositions }
	} as unknown as Guild;

	return { guild, setPositions };
}

/** A role CREATE/UPDATE carrying the position `RepositionRoles` will try to apply */
function roleAction(targetID: bigint, position: number, overrides: Partial<SnapshotRestoreAction> = {}) {
	return action({
		category   : RESTORE_OPTIONS.ROLES,
		change_type: DIFF_CHANGE_TYPE.UPDATE,
		target_id  : targetID,
		payload    : { id: targetID, name: 'Mod', color: 0, position, hoist: 0, managed_by: null, permissions: 0n },
		...overrides
	} as Partial<SnapshotRestoreAction>);
}

//////////////////
// Labels
//////////////////

describe('RunLabel', () => {
	it('names a stored snapshot by number and an import by its export ID', () => {
		expect(RunLabel(record({ snapshot_id: 142, import_id: null }))).toBe('Snapshot #142');
		expect(RunLabel(record({ snapshot_id: null, import_id: 'ABCD-1234-5678-9012' })))
			.toBe('Import #ABCD-1234-5678-9012');
	});

	it('discriminates on snapshot_id, not on import_id being present', () => {
		// A row with both set is malformed, but the stored snapshot is the one that actually ran
		expect(RunLabel(record({ snapshot_id: 7, import_id: 'ABCD-1234-5678-9012' }))).toBe('Snapshot #7');
	});
});

describe('SnapshotLabel', () => {
	it('matches RunLabel\'s two shapes, keyed on SNAPSHOT_TYPE.IMPORT', () => {
		// Every non-IMPORT type is a stored snapshot, so both of the other two must read as one
		for (const type of [SNAPSHOT_TYPE.AUTOMATIC, SNAPSHOT_TYPE.MANUAL]) {
			const stored = makeSnapshot(142, [], []);
			(stored as unknown as { type: number }).type = type;

			expect(SnapshotLabel(stored)).toBe('Snapshot #142');
		}

		expect(SnapshotLabel(makeJSONSnapshot('ABCD-1234-5678-9012', [], []))).toBe('Import #ABCD-1234-5678-9012');
	});
});

//////////////////
// SeedProgress
//////////////////

describe('SeedProgress', () => {
	it('zeroes every counter for an all-PENDING run, but keeps the totals', () => {
		const progress = SeedProgress([
			action({ category: RESTORE_OPTIONS.ROLES }),
			action({ category: RESTORE_OPTIONS.ROLES }),
			action({ category: RESTORE_OPTIONS.CHANNELS })
		]);

		expect(progress.get(RESTORE_OPTIONS.ROLES)).toEqual({
			total: 2, done: 0, created: 0, updated: 0, deleted: 0, failed: 0, skipped: 0
		});
		expect(progress.get(RESTORE_OPTIONS.CHANNELS)?.total).toBe(1);
	});

	it('rebuilds every counter from a partially-run set', () => {
		const progress = SeedProgress([
			action({ change_type: DIFF_CHANGE_TYPE.CREATE, result: RESTORE_RESULT.OK }),
			action({ change_type: DIFF_CHANGE_TYPE.UPDATE, result: RESTORE_RESULT.OK }),
			action({ change_type: DIFF_CHANGE_TYPE.DELETE, result: RESTORE_RESULT.OK }),
			action({ change_type: DIFF_CHANGE_TYPE.CREATE, result: RESTORE_RESULT.FAILED }),
			action({ change_type: DIFF_CHANGE_TYPE.DELETE, result: RESTORE_RESULT.SKIPPED }),
			action({ change_type: DIFF_CHANGE_TYPE.UPDATE, result: RESTORE_RESULT.PENDING })
		]);

		expect(progress.get(RESTORE_OPTIONS.ROLES)).toEqual({
			total: 6, done: 5, created: 1, updated: 1, deleted: 1, failed: 1, skipped: 1
		});
	});

	it('counts created/updated/deleted off OK rows only', () => {
		// A FAILED create must not be reported as a creation - the role does not exist
		const progress = SeedProgress([
			action({ change_type: DIFF_CHANGE_TYPE.CREATE, result: RESTORE_RESULT.FAILED }),
			action({ change_type: DIFF_CHANGE_TYPE.CREATE, result: RESTORE_RESULT.SKIPPED })
		]);

		expect(progress.get(RESTORE_OPTIONS.ROLES)).toMatchObject({ created: 0, failed: 1, skipped: 1, done: 2 });
	});

	it('gives an absent category a zeroed entry rather than leaving it undefined', () => {
		// `ExecuteRun` does `run.progress.get(action.category)!` - a missing entry is a crash
		const progress = SeedProgress([ action({ category: RESTORE_OPTIONS.ROLES }) ]);

		expect(progress.get(RESTORE_OPTIONS.CHANNELS)).toEqual({
			total: 0, done: 0, created: 0, updated: 0, deleted: 0, failed: 0, skipped: 0
		});
		expect(progress.get(RESTORE_OPTIONS.BANS)?.total).toBe(0);
	});

	it('never seeds MESSAGES, which is not an implemented category', () => {
		const progress = SeedProgress([ action({ category: RESTORE_OPTIONS.MESSAGES }) ]);

		expect(progress.has(RESTORE_OPTIONS.MESSAGES)).toBe(false);
		expect([...progress.keys()]).toEqual([RESTORE_OPTIONS.ROLES, RESTORE_OPTIONS.CHANNELS, RESTORE_OPTIONS.BANS]);
	});
});

describe('BuildRun', () => {
	it('seeds run-level counters from persisted results', () => {
		const built = run([
			action({ result: RESTORE_RESULT.OK }),
			action({ result: RESTORE_RESULT.FAILED }),
			action({ result: RESTORE_RESULT.SKIPPED }),
			action({ result: RESTORE_RESULT.PENDING })
		]);

		expect(built).toMatchObject({ total: 4, applied: 1, failed: 1, skipped: 1 });
	});

	it('stringifies the bigint snowflake columns and nulls a missing message', () => {
		const built = run([], { guild_id: 10n, channel_id: 30n, message_id: null });

		expect(built.guild_id).toBe('10');
		expect(built.channel_id).toBe('30');
		expect(built.message_id).toBe(null);
		expect(built.started_at).toBe(NOW);
	});
});

//////////////////
// CountResult
//////////////////

describe('CountResult', () => {
	/** The two-call transition `ExecuteRun` performs: leave the old bucket, enter the new one */
	function transition(built: RestoreRun, from: number, to: number, changeType = DIFF_CHANGE_TYPE.CREATE) {
		const progress = built.progress.get(RESTORE_OPTIONS.ROLES)!;
		CountResult(built, progress, changeType as SnapshotRestoreAction['change_type'], from as never, -1);
		CountResult(built, progress, changeType as SnapshotRestoreAction['change_type'], to as never, 1);
		return progress;
	}

	it('moves a retried failure out of failed and into created, counting it once', () => {
		// The retry double-count guard: without the -1 leg this ends at failed 1 / created 1
		const built = run([ action({ change_type: DIFF_CHANGE_TYPE.CREATE, result: RESTORE_RESULT.FAILED }) ]);
		expect(built).toMatchObject({ failed: 1, applied: 0 });

		const progress = transition(built, RESTORE_RESULT.FAILED, RESTORE_RESULT.OK);

		expect(built).toMatchObject({ failed: 0, applied: 1 });
		expect(progress).toMatchObject({ failed: 0, created: 1, done: 1 });
	});

	it('treats PENDING as occupying no bucket, in either direction', () => {
		const built = run([ action() ]);
		const progress = built.progress.get(RESTORE_OPTIONS.ROLES)!;
		const before = { ...progress };

		CountResult(built, progress, DIFF_CHANGE_TYPE.CREATE, RESTORE_RESULT.PENDING, -1);
		CountResult(built, progress, DIFF_CHANGE_TYPE.CREATE, RESTORE_RESULT.PENDING, 1);

		expect(progress).toEqual(before);
		expect(built).toMatchObject({ applied: 0, failed: 0, skipped: 0 });
	});

	it('routes an OK result to the bucket matching its change type', () => {
		const built = run([ action(), action(), action() ]);
		const progress = built.progress.get(RESTORE_OPTIONS.ROLES)!;

		CountResult(built, progress, DIFF_CHANGE_TYPE.CREATE, RESTORE_RESULT.OK, 1);
		CountResult(built, progress, DIFF_CHANGE_TYPE.UPDATE, RESTORE_RESULT.OK, 1);
		CountResult(built, progress, DIFF_CHANGE_TYPE.DELETE, RESTORE_RESULT.OK, 1);

		expect(progress).toMatchObject({ created: 1, updated: 1, deleted: 1, done: 3, failed: 0, skipped: 0 });
		expect(built.applied).toBe(3);
	});

	it('moves FAILED and SKIPPED at both the run and category level, and only theirs', () => {
		const built = run([ action(), action() ]);
		const progress = built.progress.get(RESTORE_OPTIONS.ROLES)!;

		CountResult(built, progress, DIFF_CHANGE_TYPE.CREATE, RESTORE_RESULT.FAILED, 1);
		expect(built).toMatchObject({ failed: 1, applied: 0, skipped: 0 });
		expect(progress).toMatchObject({ failed: 1, created: 0, skipped: 0, done: 1 });

		CountResult(built, progress, DIFF_CHANGE_TYPE.DELETE, RESTORE_RESULT.SKIPPED, 1);
		expect(built).toMatchObject({ failed: 1, applied: 0, skipped: 1 });
		expect(progress).toMatchObject({ failed: 1, deleted: 0, skipped: 1, done: 2 });
	});

	it('leaves other categories untouched', () => {
		const built = run([ action({ category: RESTORE_OPTIONS.ROLES }), action({ category: RESTORE_OPTIONS.CHANNELS }) ]);

		CountResult(built, built.progress.get(RESTORE_OPTIONS.ROLES)!, DIFF_CHANGE_TYPE.CREATE, RESTORE_RESULT.OK, 1);

		expect(built.progress.get(RESTORE_OPTIONS.CHANNELS)).toMatchObject({ done: 0, created: 0, total: 1 });
	});

	it('lands a first run on exactly what SeedProgress would rebuild from the same rows', () => {
		// A resumed or retried run must render identically to the run that produced it
		const outcomes = [
			{ change_type: DIFF_CHANGE_TYPE.CREATE, result: RESTORE_RESULT.OK },
			{ change_type: DIFF_CHANGE_TYPE.UPDATE, result: RESTORE_RESULT.OK },
			{ change_type: DIFF_CHANGE_TYPE.DELETE, result: RESTORE_RESULT.FAILED },
			{ change_type: DIFF_CHANGE_TYPE.CREATE, result: RESTORE_RESULT.SKIPPED }
		];

		const live = run(outcomes.map(o => action({ change_type: o.change_type })));
		const progress = live.progress.get(RESTORE_OPTIONS.ROLES)!;

		for (const outcome of outcomes) {
			CountResult(live, progress, outcome.change_type, RESTORE_RESULT.PENDING, -1);
			CountResult(live, progress, outcome.change_type, outcome.result, 1);
		}

		const seeded = SeedProgress(outcomes.map(o => action({ change_type: o.change_type, result: o.result })));

		expect(progress).toEqual(seeded.get(RESTORE_OPTIONS.ROLES));
	});
});

//////////////////
// RehydrateRemap
//////////////////

describe('RehydrateRemap', () => {
	it('rebuilds every target_id -> new_id pair', () => {
		const remap = RehydrateRemap([
			action({ target_id: 1n, new_id: 100n }),
			action({ target_id: 2n, new_id: 200n })
		]);

		expect(remap.get(1n)).toBe(100n);
		expect(remap.get(2n)).toBe(200n);
		expect(remap.size).toBe(2);
	});

	it('ignores rows with no new_id, which is every UPDATE and DELETE', () => {
		const remap = RehydrateRemap([
			action({ target_id: 1n, new_id: null, change_type: DIFF_CHANGE_TYPE.UPDATE }),
			action({ target_id: 2n, new_id: null, change_type: DIFF_CHANGE_TYPE.DELETE })
		]);

		expect(remap.size).toBe(0);
	});
});

//////////////////
// RenderProgressLines
//////////////////

describe('RenderProgressLines', () => {
	/** Drives a category's counters directly, so each render state can be produced in isolation */
	function withProgress(category: number, counters: Record<string, number>, overrides: Partial<SnapshotRestore> = {}) {
		const built = run(Array.from({ length: counters.total }, () => action({ category: category as never })), overrides);
		Object.assign(built.progress.get(category as never)!, counters);
		return built;
	}

	it('renders an untouched category as queued', () => {
		const lines = RenderProgressLines(withProgress(RESTORE_OPTIONS.ROLES, { total: 3, done: 0 }));

		expect(lines).toEqual(['· 👥 Roles - queued']);
	});

	it('renders a partially applied category as a fraction', () => {
		const lines = RenderProgressLines(withProgress(RESTORE_OPTIONS.ROLES, { total: 4, done: 2 }));

		expect(lines).toEqual([`${EMOJI.LOADING} 👥 Roles - 2 / 4`]);
	});

	it('renders a finished clean category with a success icon and a counter breakdown', () => {
		const lines = RenderProgressLines(withProgress(RESTORE_OPTIONS.ROLES, {
			total: 6, done: 6, created: 3, updated: 2, deleted: 1
		}));

		expect(lines).toEqual([`${EMOJI.SUCCESS} 👥 Roles - 3 created, 2 updated, 1 deleted`]);
	});

	it('reports skips as "N skipped" with an info icon, never as nothing to do', () => {
		// A stopped run leaves whole categories skipped; "nothing to do" would be the opposite of true
		const lines = RenderProgressLines(withProgress(RESTORE_OPTIONS.ROLES, {
			total: 5, done: 5, created: 2, skipped: 3
		}));

		expect(lines).toEqual([`${EMOJI.INFO} 👥 Roles - 2 created, 3 skipped`]);
		expect(lines[0]).not.toContain('nothing to do');
	});

	it('lets failures win the icon over skips', () => {
		const lines = RenderProgressLines(withProgress(RESTORE_OPTIONS.ROLES, {
			total: 4, done: 4, failed: 1, skipped: 3
		}));

		expect(lines).toEqual([`${EMOJI.WARNING} 👥 Roles - 1 failed, 3 skipped`]);
	});

	it('says "nothing to do" only when a done category moved no counter at all', () => {
		const lines = RenderProgressLines(withProgress(RESTORE_OPTIONS.ROLES, { total: 2, done: 2 }));

		expect(lines).toEqual([`${EMOJI.SUCCESS} 👥 Roles - nothing to do`]);
	});

	it('omits zero-total categories entirely', () => {
		const lines = RenderProgressLines(run([ action({ category: RESTORE_OPTIONS.ROLES }) ]));

		expect(lines).toHaveLength(1);
		expect(lines.join('\n')).not.toContain('Channels');
		expect(lines.join('\n')).not.toContain('Bans');
	});

	it('orders categories roles, channels, bans regardless of action order', () => {
		const built = run([
			action({ category: RESTORE_OPTIONS.BANS }),
			action({ category: RESTORE_OPTIONS.CHANNELS }),
			action({ category: RESTORE_OPTIONS.ROLES })
		]);

		expect(RenderProgressLines(built).map(line => line.split(' - ')[0])).toEqual([
			'· 👥 Roles', '· 📁 Channels', '· 🚫 Bans'
		]);
	});

	it('leads with the safety snapshot line only when one was taken', () => {
		const withSafety = run([ action() ], { safety_snapshot_id: 77 });
		const without    = run([ action() ], { safety_snapshot_id: null });

		expect(RenderProgressLines(withSafety)[0]).toBe(`${EMOJI.SUCCESS} Safety snapshot #77 saved`);
		expect(RenderProgressLines(without)[0]).not.toContain('Safety snapshot');
	});

	it('appends notes last, one info line each', () => {
		const built = run([ action() ], { safety_snapshot_id: 77 });
		built.notes.push('Reordered roles, except 2 that sit above my highest role', 'Retrying 3 failed actions');

		const lines = RenderProgressLines(built);

		expect(lines.slice(-2)).toEqual([
			`${EMOJI.INFO} Reordered roles, except 2 that sit above my highest role`,
			`${EMOJI.INFO} Retrying 3 failed actions`
		]);
	});
});

//////////////////
// RenderFinished
//////////////////

describe('RenderFinished', () => {
	function finished(status: number, built: RestoreRun) {
		return RenderFinished(built, status as never);
	}

	function description(status: number, built: RestoreRun): string {
		return finished(status, built).embeds[0].description!;
	}

	function labels(status: number, built: RestoreRun): string[] {
		return finished(status, built).components[0].components.map(button => button.label!);
	}

	/** A run whose rows all failed, so FAILED renders with a non-zero count */
	function failedRun(count = 2) {
		return run(Array.from({ length: count }, (_, index) =>
			action({ result: RESTORE_RESULT.FAILED, error: `cause ${index}`, label: `@Role${index}` })
		));
	}

	it('titles and colours COMPLETE as a success', () => {
		const payload = finished(RESTORE_STATUS.COMPLETE, run([ action({ result: RESTORE_RESULT.OK }) ]));

		expect(payload.embeds[0].title).toBe(`${EMOJI.SUCCESS} Restore complete`);
		expect(payload.embeds[0].color).toBe(COLOR.SUCCESS);
		expect(payload.embeds[0].description).toContain('The server now matches Snapshot #142.');
	});

	it('titles FAILED with the failure count, pluralised', () => {
		expect(finished(RESTORE_STATUS.FAILED, failedRun(1)).embeds[0].title)
			.toBe(`${EMOJI.ERROR} Restore finished with 1 failure`);
		expect(finished(RESTORE_STATUS.FAILED, failedRun(2)).embeds[0].title)
			.toBe(`${EMOJI.ERROR} Restore finished with 2 failures`);
	});

	it('colours every non-COMPLETE status as an error', () => {
		for (const status of [RESTORE_STATUS.FAILED, RESTORE_STATUS.STOPPED, RESTORE_STATUS.INTERRUPTED]) {
			expect(finished(status, failedRun()).embeds[0].color).toBe(COLOR.ERROR);
		}
	});

	it('warns that a STOPPED server is half restored, and that skips cannot be retried', () => {
		const built = run([ action({ result: RESTORE_RESULT.SKIPPED }), action({ result: RESTORE_RESULT.SKIPPED }) ]);
		const text = description(RESTORE_STATUS.STOPPED, built);

		expect(finished(RESTORE_STATUS.STOPPED, built).embeds[0].title).toBe(`${EMOJI.STOP} Restore stopped`);
		expect(text).toContain('**This server is half restored.**');
		expect(text).toContain('2 actions never ran');
		expect(text).toContain('Skipped actions cannot be retried');
	});

	it('warns the same way for INTERRUPTED, and explains why it did not resume', () => {
		const text = description(RESTORE_STATUS.INTERRUPTED, run([ action({ result: RESTORE_RESULT.SKIPPED }) ]));

		expect(text).toContain('**This server is half restored.**');
		expect(text).toContain('did not resume');
		expect(text).toContain('Skipped actions cannot be retried');
	});

	it('pluralises the stopped-action count', () => {
		expect(description(RESTORE_STATUS.STOPPED, run([ action({ result: RESTORE_RESULT.SKIPPED }) ])))
			.toContain('1 action never ran');
	});

	it('offers Retry only on FAILED with failures to replay', () => {
		expect(labels(RESTORE_STATUS.FAILED, failedRun(2))).toContain('Retry 2 failures');
		expect(labels(RESTORE_STATUS.FAILED, failedRun(1))).toContain('Retry 1 failure');

		// A stopped run's remainder was never attempted, so there is nothing to replay
		expect(labels(RESTORE_STATUS.STOPPED, failedRun(2)).some(l => l.startsWith('Retry'))).toBe(false);
		expect(labels(RESTORE_STATUS.INTERRUPTED, failedRun(2)).some(l => l.startsWith('Retry'))).toBe(false);
		expect(labels(RESTORE_STATUS.COMPLETE, run([ action({ result: RESTORE_RESULT.OK }) ]))
			.some(l => l.startsWith('Retry'))).toBe(false);
	});

	it('always offers the log download', () => {
		for (const status of [RESTORE_STATUS.COMPLETE, RESTORE_STATUS.FAILED, RESTORE_STATUS.STOPPED, RESTORE_STATUS.INTERRUPTED]) {
			expect(labels(status, failedRun())).toContain('Download log');
		}
	});

	it('points the safety snapshot button at restore-safety, not snapshot-manage (Bug #4)', () => {
		// `snapshot-manage` is an update-in-place handler - it would consume the public step log
		const built = run([ action({ result: RESTORE_RESULT.OK }) ], { safety_snapshot_id: 77 });
		// The completion embed has no link buttons, so every one carries a custom_id
		const buttons = finished(RESTORE_STATUS.COMPLETE, built).components[0].components
			.filter(button => 'custom_id' in button);
		const safety = buttons.find(button => button.label === 'Snapshot #77');

		expect(safety?.custom_id).toBe('restore-safety_77');
		expect(buttons.every(button => !button.custom_id.startsWith('snapshot-manage'))).toBe(true);
	});

	it('omits the snapshot button and the recovery line when no safety snapshot was taken', () => {
		const built = run([ action({ result: RESTORE_RESULT.OK }) ], { safety_snapshot_id: null });

		expect(labels(RESTORE_STATUS.COMPLETE, built).some(l => l.startsWith('Snapshot #'))).toBe(false);
		expect(description(RESTORE_STATUS.COMPLETE, built)).not.toContain('holds what this server looked like');
	});

	it('names the safety snapshot as the way back', () => {
		const built = run([ action({ result: RESTORE_RESULT.OK }) ], { safety_snapshot_id: 77 });

		expect(description(RESTORE_STATUS.COMPLETE, built))
			.toContain('Snapshot #77 holds what this server looked like before the restore ran.');
	});

	it('formats duration in seconds under a minute and m/s above it', () => {
		const built = run([ action({ result: RESTORE_RESULT.OK }) ], { started_at: BigInt(NOW - 45_000) });
		expect(description(RESTORE_STATUS.COMPLETE, built)).toContain('applied in 45s.');

		const longer = run([ action({ result: RESTORE_RESULT.OK }) ], { started_at: BigInt(NOW - 90_000) });
		expect(description(RESTORE_STATUS.COMPLETE, longer)).toContain('applied in 1m 30s.');

		const exact = run([ action({ result: RESTORE_RESULT.OK }) ], { started_at: BigInt(NOW - 60_000) });
		expect(description(RESTORE_STATUS.COMPLETE, exact)).toContain('applied in 1m 0s.');
	});

	it('reports applied out of total, pluralising on the total', () => {
		expect(description(RESTORE_STATUS.COMPLETE, run([ action({ result: RESTORE_RESULT.OK }) ])))
			.toContain('**1 / 1** action applied');
		expect(description(RESTORE_STATUS.COMPLETE, run([
			action({ result: RESTORE_RESULT.OK }), action({ result: RESTORE_RESULT.OK })
		]))).toContain('**2 / 2** actions applied');
	});

	it('groups failures by cause rather than listing every entity', () => {
		const built = run([
			action({ result: RESTORE_RESULT.FAILED, error: 'above my highest role', label: '@A' }),
			action({ result: RESTORE_RESULT.FAILED, error: 'above my highest role', label: '@B' }),
			action({ result: RESTORE_RESULT.FAILED, error: 'role limit reached', label: '@C' })
		]);
		const text = description(RESTORE_STATUS.FAILED, built);

		expect(text).toContain(`${EMOJI.WARNING} 2 roles - above my highest role`);
		expect(text).toContain(`${EMOJI.WARNING} 1 role - role limit reached`);
		expect(text).not.toContain('@A');
	});

	it('omits the failures block entirely when nothing failed', () => {
		const text = description(RESTORE_STATUS.COMPLETE, run([ action({ result: RESTORE_RESULT.OK }) ]));

		expect(text).not.toContain(EMOJI.WARNING);
	});

	it('caps failure causes at six and counts the overflow', () => {
		const built = run(Array.from({ length: 8 }, (_, index) =>
			action({ result: RESTORE_RESULT.FAILED, error: `cause ${index}`, label: `@R${index}` })
		));
		const text = description(RESTORE_STATUS.FAILED, built);

		expect(text.split('\n').filter(line => line.includes(' - cause '))).toHaveLength(6);
		expect(text).toContain(`${EMOJI.INFO} ...and 2 more causes`);
	});

	it('renders the overflow tail in the singular at seven causes', () => {
		const built = run(Array.from({ length: 7 }, (_, index) =>
			action({ result: RESTORE_RESULT.FAILED, error: `cause ${index}`, label: `@R${index}` })
		));

		expect(description(RESTORE_STATUS.FAILED, built)).toContain(`${EMOJI.INFO} ...and 1 more cause -`);
	});

	it('stays under Discord\'s 4096 character description limit in the worst case', () => {
		// Worst case: stopped (longest closing), safety snapshot (recovery line), all three
		// categories with every counter populated, the failure list at overflow, and notes
		const actions = [
			...Array.from({ length: 8 }, (_, index) => action({
				category: RESTORE_OPTIONS.ROLES, result: RESTORE_RESULT.FAILED,
				error: `a fairly wordy failure cause number ${index} that Discord returned verbatim`,
				label: `@LongRoleName${index}`
			})),
			...Array.from({ length: 20 }, () => action({ category: RESTORE_OPTIONS.CHANNELS, result: RESTORE_RESULT.SKIPPED })),
			...Array.from({ length: 20 }, () => action({ category: RESTORE_OPTIONS.BANS, result: RESTORE_RESULT.OK }))
		];

		const built = run(actions, { safety_snapshot_id: 999999, started_at: BigInt(NOW - 3_600_000) });
		for (const category of [RESTORE_OPTIONS.ROLES, RESTORE_OPTIONS.CHANNELS, RESTORE_OPTIONS.BANS]) {
			Object.assign(built.progress.get(category)!, { created: 11, updated: 12, deleted: 13, failed: 14, skipped: 15 });
		}
		built.notes.push(
			'Could not reorder 40 role(s) - they sit above my highest role',
			'Retrying 48 failed actions',
			'Reordered roles, except 12 that sit above my highest role',
			'Could not reorder roles - missing permissions',
			'Safety snapshot could not be pinned - rotate it manually'
		);

		expect(description(RESTORE_STATUS.STOPPED, built).length).toBeLessThan(4096);
	});

	it('warns that recreated entities churn the next snapshot', () => {
		expect(description(RESTORE_STATUS.COMPLETE, run([ action({ result: RESTORE_RESULT.OK }) ])))
			.toContain('Recreated channels and roles have new IDs');
	});
});

//////////////////
// RepositionRoles
//////////////////

describe('RepositionRoles', () => {
	it('applies every in-range position in a single call', async () => {
		const { guild, setPositions } = makeRoleGuild([{ id: '2', managed: false }, { id: '3', managed: false }]);

		const note = await RepositionRoles(guild, [roleAction(2n, 5), roleAction(3n, 7)], new Map());

		expect(setPositions).toHaveBeenCalledTimes(1);
		expect(setPositions).toHaveBeenCalledWith([{ role: '2', position: 5 }, { role: '3', position: 7 }]);
		expect(note).toBe(null);
	});

	it('drops roles at or above the bot\'s highest and says how many', async () => {
		// Discord rejects the whole call if any single entry is out of range
		const { guild, setPositions } = makeRoleGuild([{ id: '2', managed: false }, { id: '3', managed: false }], 10);

		const note = await RepositionRoles(guild, [roleAction(2n, 5), roleAction(3n, 10)], new Map());

		expect(setPositions).toHaveBeenCalledWith([{ role: '2', position: 5 }]);
		expect(note).toBe('Reordered roles, except 1 that sit above my highest role');
	});

	it('reports without calling Discord when every role was clamped out', async () => {
		const { guild, setPositions } = makeRoleGuild([{ id: '2', managed: false }, { id: '3', managed: false }], 5);

		const note = await RepositionRoles(guild, [roleAction(2n, 5), roleAction(3n, 9)], new Map());

		expect(setPositions).not.toHaveBeenCalled();
		expect(note).toBe('Could not reorder 2 role(s) - they sit above my highest role');
	});

	it('skips @everyone, which is pinned at 0 and is not flagged managed', async () => {
		const { guild, setPositions } = makeRoleGuild([{ id: '1', managed: false }, { id: '2', managed: false }]);

		await RepositionRoles(guild, [roleAction(1n, 0), roleAction(2n, 5)], new Map());

		expect(setPositions).toHaveBeenCalledWith([{ role: '2', position: 5 }]);
	});

	it('skips managed roles and roles missing from cache', async () => {
		const { guild, setPositions } = makeRoleGuild([{ id: '2', managed: true }, { id: '3', managed: false }]);

		// 4n is in no cache at all - a role the run failed to create
		await RepositionRoles(guild, [roleAction(2n, 5), roleAction(3n, 6), roleAction(4n, 7)], new Map());

		expect(setPositions).toHaveBeenCalledWith([{ role: '3', position: 6 }]);
	});

	it('ignores deletes and payload-less actions', async () => {
		const { guild, setPositions } = makeRoleGuild([{ id: '2', managed: false }, { id: '3', managed: false }]);

		const note = await RepositionRoles(guild, [
			roleAction(2n, 5, { change_type: DIFF_CHANGE_TYPE.DELETE, payload: null }),
			roleAction(3n, 6, { payload: null })
		], new Map());

		expect(setPositions).not.toHaveBeenCalled();
		expect(note).toBe(null);
	});

	it('ignores non-role actions', async () => {
		const { guild, setPositions } = makeRoleGuild([{ id: '2', managed: false }]);

		await RepositionRoles(guild, [roleAction(2n, 5, { category: RESTORE_OPTIONS.CHANNELS })], new Map());

		expect(setPositions).not.toHaveBeenCalled();
	});

	it('looks a recreated role up by its new snowflake', async () => {
		// The role was created this run, so the cache only knows its new ID
		const { guild, setPositions } = makeRoleGuild([{ id: '500', managed: false }]);

		await RepositionRoles(guild, [roleAction(2n, 5, { change_type: DIFF_CHANGE_TYPE.CREATE })], new Map([[2n, 500n]]));

		expect(setPositions).toHaveBeenCalledWith([{ role: '500', position: 5 }]);
	});

	it('falls back to position 0 as the ceiling when the bot has no member object', async () => {
		const { guild, setPositions } = makeRoleGuild([{ id: '2', managed: false }]);
		(guild as unknown as { members: { me: null } }).members.me = null;

		const note = await RepositionRoles(guild, [roleAction(2n, 5)], new Map());

		expect(setPositions).not.toHaveBeenCalled();
		expect(note).toBe('Could not reorder 1 role(s) - they sit above my highest role');
	});

	it('returns a note and logs when setPositions throws, rather than failing the run', async () => {
		const { guild, setPositions } = makeRoleGuild([{ id: '2', managed: false }]);
		setPositions.mockRejectedValue(new Error('Missing Permissions'));

		const note = await RepositionRoles(guild, [roleAction(2n, 5)], new Map());

		expect(note).toBe('Could not reorder roles - Missing Permissions');
		expect(LogSpy).toHaveBeenCalledWith('ERROR', expect.any(Error));
	});
});
