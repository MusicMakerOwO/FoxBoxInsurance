import { describe, it, expect } from 'vitest';
import { DiscordAPIError } from 'discord.js';
import { DIFF_CHANGE_TYPE, RESTORE_OPTIONS, RESTORE_RESULT } from '../../Utils/Constants.js';
import { SnapshotRestoreAction } from '../../Typings/DatabaseTypes.js';
import { DescribeError, DescribeFailureGroup, GroupFailures } from '../../Utils/Snapshots/RestoreFailures.js';

/**
 * `DiscordAPIError`'s constructor is `(rawError, code, status, method, url, bodyData)`. Only `code`
 * is read by `DescribeError`, but the rest have to be present or the `message` getter throws - and
 * `message` is the unmapped-code fallback, so it has to be real.
 */
function apiError(code: number, message = `Discord says ${code}`): DiscordAPIError {
	return new DiscordAPIError({ code, message }, code, 400, 'POST', 'https://discord.test/x', {});
}

/** Only the four fields `GroupFailures` reads; the rest of the row is irrelevant to grouping */
function failure(overrides: Partial<SnapshotRestoreAction> = {}): SnapshotRestoreAction {
	return {
		restore_id : 1,
		seq        : 0,
		category   : RESTORE_OPTIONS.ROLES,
		change_type: DIFF_CHANGE_TYPE.UPDATE,
		target_id  : 1n,
		new_id     : null,
		label      : '@Mod',
		payload    : null,
		result     : RESTORE_RESULT.FAILED,
		error      : 'above my highest role',
		...overrides
	} as SnapshotRestoreAction;
}

describe('DescribeError', () => {
	it('prefers the category override over the generic map', () => {
		// 50013 is "missing permissions" generically, but for a role it is almost always hierarchy
		expect(DescribeError(apiError(50013), RESTORE_OPTIONS.ROLES   )).toBe('above my highest role');
		expect(DescribeError(apiError(50013), RESTORE_OPTIONS.CHANNELS)).toBe('missing Manage Channels');
		expect(DescribeError(apiError(50013), RESTORE_OPTIONS.BANS    )).toBe('missing Ban Members');
	});

	it('falls back to the generic map when the category has no override for that code', () => {
		// CHANNELS overrides 50013 but not 50001, so this must not leak the 50013 override
		expect(DescribeError(apiError(50001), RESTORE_OPTIONS.CHANNELS)).toBe('missing access');
		expect(DescribeError(apiError(10003), RESTORE_OPTIONS.CHANNELS)).toBe('channel no longer exists');
	});

	it('uses ERROR_MESSAGES only when no category is supplied', () => {
		expect(DescribeError(apiError(50013))).toBe('missing permissions');
		expect(DescribeError(apiError(50001))).toBe('missing access');
		expect(DescribeError(apiError(10011))).toBe('role no longer exists');
		expect(DescribeError(apiError(10026))).toBe('user is not banned');
	});

	it('falls back to the raw message for an unmapped code', () => {
		expect(DescribeError(apiError(40001, 'Unauthorized'), RESTORE_OPTIONS.ROLES)).toBe('Unauthorized');
	});

	it('falls back to the message for a plain Error, mapped code or not', () => {
		expect(DescribeError(new Error('socket hang up'), RESTORE_OPTIONS.ROLES)).toBe('socket hang up');
	});

	it('stringifies a non-Error throw', () => {
		expect(DescribeError('boom')).toBe('boom');
		expect(DescribeError(50013)).toBe('50013');
		expect(DescribeError(null)).toBe('null');
		expect(DescribeError(undefined)).toBe('undefined');
	});

	it('is byte-stable across calls, so identical causes collapse in GroupFailures', () => {
		// Two separate error objects for the same failure must not produce two groups
		expect(DescribeError(apiError(50013), RESTORE_OPTIONS.ROLES))
			.toBe(DescribeError(apiError(50013), RESTORE_OPTIONS.ROLES));
	});
});

describe('GroupFailures', () => {
	it('groups on (category, error)', () => {
		const groups = GroupFailures([
			failure({ seq: 0, label: '@Mod'   }),
			failure({ seq: 1, label: '@Admin' }),
			failure({ seq: 2, label: '@Helper', error: 'role limit reached' })
		]);

		expect(groups).toHaveLength(2);
		expect(groups[0]).toMatchObject({ reason: 'above my highest role', labels: ['@Mod', '@Admin'] });
		expect(groups[1]).toMatchObject({ reason: 'role limit reached'   , labels: ['@Helper'] });
	});

	it('keeps labels in seq order within a group', () => {
		const groups = GroupFailures([
			failure({ seq: 0, label: '@A' }),
			failure({ seq: 1, label: '@B' }),
			failure({ seq: 2, label: '@C' })
		]);

		expect(groups[0].labels).toEqual(['@A', '@B', '@C']);
	});

	it('does not merge different categories that share a reason string', () => {
		const groups = GroupFailures([
			failure({ category: RESTORE_OPTIONS.ROLES   , label: '@Mod'  , error: 'missing access' }),
			failure({ category: RESTORE_OPTIONS.CHANNELS, label: '#rules', error: 'missing access' })
		]);

		expect(groups).toHaveLength(2);
		expect(groups.map(g => g.category).sort()).toEqual([RESTORE_OPTIONS.CHANNELS, RESTORE_OPTIONS.ROLES].sort());
		expect(groups.every(g => g.labels.length === 1)).toBe(true);
	});

	it('ignores every non-FAILED result', () => {
		const groups = GroupFailures([
			failure({ result: RESTORE_RESULT.OK     , error: null }),
			failure({ result: RESTORE_RESULT.SKIPPED, error: null }),
			failure({ result: RESTORE_RESULT.PENDING, error: null }),
			failure({ result: RESTORE_RESULT.FAILED , label: '@Mod' })
		]);

		expect(groups).toHaveLength(1);
		expect(groups[0].labels).toEqual(['@Mod']);
	});

	it('returns nothing when no action failed', () => {
		expect(GroupFailures([ failure({ result: RESTORE_RESULT.OK, error: null }) ])).toEqual([]);
		expect(GroupFailures([])).toEqual([]);
	});

	it('groups a null error under "unknown error"', () => {
		// FAILED with no recorded cause shouldn't crash the log render or split into per-row groups
		const groups = GroupFailures([
			failure({ label: '@A', error: null }),
			failure({ label: '@B', error: null })
		]);

		expect(groups).toHaveLength(1);
		expect(groups[0].reason).toBe('unknown error');
		expect(groups[0].labels).toEqual(['@A', '@B']);
	});

	it('sorts by group size descending, so the biggest fix reads first', () => {
		const groups = GroupFailures([
			failure({ label: '@one'  , error: 'one'  }),
			failure({ label: '@two-a', error: 'two'  }),
			failure({ label: '@two-b', error: 'two'  }),
			failure({ label: '@3-a'  , error: 'three' }),
			failure({ label: '@3-b'  , error: 'three' }),
			failure({ label: '@3-c'  , error: 'three' })
		]);

		expect(groups.map(g => g.labels.length)).toEqual([3, 2, 1]);
		expect(groups.map(g => g.reason)).toEqual(['three', 'two', 'one']);
	});
});

describe('DescribeFailureGroup', () => {
	it('pluralises on group size', () => {
		expect(DescribeFailureGroup({ category: RESTORE_OPTIONS.ROLES, reason: 'above my highest role', labels: ['@A'] }))
			.toBe('1 role - above my highest role');

		expect(DescribeFailureGroup({
			category: RESTORE_OPTIONS.ROLES,
			reason  : 'above my highest role',
			labels  : ['@A', '@B', '@C', '@D', '@E', '@F']
		})).toBe('6 roles - above my highest role');
	});

	it('has a noun pair for every restore category', () => {
		const nouns = Object.values(RESTORE_OPTIONS).map(category =>
			DescribeFailureGroup({ category, reason: 'x', labels: ['a', 'b'] })
		);

		// Undefined destructuring would throw before this; a missing entry is the failure mode
		expect(nouns).toEqual([
			'2 channels - x',
			'2 roles - x',
			'2 bans - x',
			'2 messages - x'
		]);
	});
});
