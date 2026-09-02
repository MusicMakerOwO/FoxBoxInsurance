import { describe, it, expect, vi, afterEach } from 'vitest';
import { ChannelType } from 'discord.js';
import { DIFF_CHANGE_TYPE, RESTORE_OPTIONS, RESTORE_PRESETS } from '../../Utils/Constants.js';
import { BOT_ROLE, BOT_USER_ID, EVERYONE, GUILD_ID, channel, emptySnapshot, makeGuild, makeSnapshot, role } from './Fixtures.js';

// `MoveBotRoleToTop` resolves the bot role through `client.user.id`, and throws if neither side has
// one - so every fixture below carries a role owned by this ID
vi.mock('../../Client.js', () => ({ client: { user: { id: BOT_USER_ID } } }));

const { BuildRestorePlan, GetCachedPlan, InvalidateRestorePlans } = await import('../../Services/RestorePlans.js');

afterEach(() => {
	InvalidateRestorePlans(GUILD_ID);
	InvalidateRestorePlans('2');
	vi.useRealTimers();
});

describe('BuildRestorePlan - fingerprint', () => {
	it('is stable across a rebuild with nothing changed', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE, role(2n, 'Mod')], [channel(10n, 'general', ChannelType.GuildText, null)]);

		const first = await BuildRestorePlan(guild, emptySnapshot(1), RESTORE_PRESETS.FULL);
		InvalidateRestorePlans(GUILD_ID);
		const second = await BuildRestorePlan(guild, emptySnapshot(1), RESTORE_PRESETS.FULL);

		expect(second).not.toBe(first); // genuinely rebuilt, not served from the plan cache
		expect(second.fingerprint).toBe(first.fingerprint);
	});

	it('ignores the iteration order of the live caches', async () => {
		const roles = [BOT_ROLE, EVERYONE, role(2n, 'Mod'), role(3n, 'Helper')];
		const channels = [channel(10n, 'general', ChannelType.GuildText, null), channel(11n, 'off-topic', ChannelType.GuildText, null)];

		const forward = await BuildRestorePlan(makeGuild(roles, channels), emptySnapshot(2), RESTORE_PRESETS.FULL);
		InvalidateRestorePlans(GUILD_ID);
		// Same entities, re-inserted in the opposite order - this is what a discord.js cache
		// re-insertion between preview and confirm looks like, and it used to change the hash
		const reversed = await BuildRestorePlan(makeGuild([...roles].reverse(), [...channels].reverse()), emptySnapshot(2), RESTORE_PRESETS.FULL);

		expect(reversed.actions).toHaveLength(forward.actions.length);
		expect(reversed.fingerprint).toBe(forward.fingerprint);
	});

	it('does not move when only a payload field differs', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE], []);

		// Same role ID on both runs, so the action set is identical - only the colour it would be
		// updated to differs. Payloads come from the immutable snapshot, so this cannot happen from
		// live drift; asserting it pins the narrowed hash input
		const blue = await BuildRestorePlan(guild, makeSnapshot(3, [BOT_ROLE, EVERYONE, role(4n, 'Mod', { color: 0x0000ff })], []), RESTORE_PRESETS.FULL);
		InvalidateRestorePlans(GUILD_ID);
		const red = await BuildRestorePlan(guild, makeSnapshot(3, [BOT_ROLE, EVERYONE, role(4n, 'Mod', { color: 0xff0000 })], []), RESTORE_PRESETS.FULL);

		expect(blue.actions).toHaveLength(1);
		expect(blue.actions[0].change_type).toBe(DIFF_CHANGE_TYPE.CREATE);
		expect(red.fingerprint).toBe(blue.fingerprint);
	});

	it('moves when an action is added to the set', async () => {
		const before = await BuildRestorePlan(makeGuild([BOT_ROLE, EVERYONE, role(2n, 'Mod')], []), emptySnapshot(4), RESTORE_PRESETS.FULL);
		InvalidateRestorePlans(GUILD_ID);
		// A role appearing in the live guild is one more DELETE the admin never reviewed
		const after = await BuildRestorePlan(makeGuild([BOT_ROLE, EVERYONE, role(2n, 'Mod'), role(3n, 'Helper')], []), emptySnapshot(4), RESTORE_PRESETS.FULL);

		expect(after.actions.length).toBe(before.actions.length + 1);
		expect(after.fingerprint).not.toBe(before.fingerprint);
	});

	it('moves when an action is removed from the set', async () => {
		// The mirror of the case above: a role deleted by hand between preview and confirm means the
		// admin was shown a DELETE that no longer applies
		const before = await BuildRestorePlan(makeGuild([BOT_ROLE, EVERYONE, role(2n, 'Mod'), role(3n, 'Helper')], []), emptySnapshot(20), RESTORE_PRESETS.FULL);
		InvalidateRestorePlans(GUILD_ID);
		const after = await BuildRestorePlan(makeGuild([BOT_ROLE, EVERYONE, role(2n, 'Mod')], []), emptySnapshot(20), RESTORE_PRESETS.FULL);

		expect(after.actions.length).toBe(before.actions.length - 1);
		expect(after.fingerprint).not.toBe(before.fingerprint);
	});

	it('moves when a change_type flips on the same target', async () => {
		const snapshot = makeSnapshot(21, [BOT_ROLE, EVERYONE, role(2n, 'Mod', { color: 0xff0000 })], []);

		// Role absent live -> CREATE
		const created = await BuildRestorePlan(makeGuild([BOT_ROLE, EVERYONE], []), snapshot, RESTORE_PRESETS.FULL);
		InvalidateRestorePlans(GUILD_ID);
		// Same role ID now present live but the wrong colour -> UPDATE. Same target, same category,
		// different verb: the hash has to see it
		const updated = await BuildRestorePlan(makeGuild([BOT_ROLE, EVERYONE, role(2n, 'Mod', { color: 0x00ff00 })], []), snapshot, RESTORE_PRESETS.FULL);

		expect(created.actions[0].change_type).toBe(DIFF_CHANGE_TYPE.CREATE);
		expect(updated.actions[0].change_type).toBe(DIFF_CHANGE_TYPE.UPDATE);
		expect(updated.actions[0].target_id).toBe(created.actions[0].target_id);
		expect(updated.fingerprint).not.toBe(created.fingerprint);
	});

	it('renders bigint target IDs identically across rebuilds', async () => {
		// The tuples are template-interpolated rather than JSON-stringified, so there is no
		// `JSONReplacer` seam left that could render `123n` one way and `123` another
		const big = role(9007199254740993n, 'Beyond Number.MAX_SAFE_INTEGER');
		const guild = makeGuild([BOT_ROLE, EVERYONE, big], []);

		const first = await BuildRestorePlan(guild, emptySnapshot(22), RESTORE_PRESETS.FULL);
		InvalidateRestorePlans(GUILD_ID);
		const second = await BuildRestorePlan(guild, emptySnapshot(22), RESTORE_PRESETS.FULL);

		expect(first.actions.some(a => a.target_id === 9007199254740993n)).toBe(true);
		expect(second.fingerprint).toBe(first.fingerprint);
	});

	it('is computed for an empty plan and is stable', async () => {
		// mask 0 still has to produce a usable plan object - the toggle screen renders one
		const guild = makeGuild([BOT_ROLE, EVERYONE, role(2n, 'Mod')], []);

		const first = await BuildRestorePlan(guild, emptySnapshot(23), 0);
		InvalidateRestorePlans(GUILD_ID);
		const second = await BuildRestorePlan(guild, emptySnapshot(23), 0);

		expect(first.actions).toHaveLength(0);
		expect(first.fingerprint).toHaveLength(64);
		expect(second.fingerprint).toBe(first.fingerprint);
	});
});

describe('BuildRestorePlan - plan cache', () => {
	it('serves a repeat build from the cache without re-diffing', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE, role(2n, 'Mod')], []);

		const first = await BuildRestorePlan(guild, emptySnapshot(30), RESTORE_PRESETS.FULL);
		const second = await BuildRestorePlan(guild, emptySnapshot(30), RESTORE_PRESETS.FULL);

		expect(second).toBe(first); // same object reference, so no rebuild happened
	});

	it('keys the cache on the mask, so two scopes never collide', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE, role(2n, 'Mod')], [channel(10n, 'general', ChannelType.GuildText, null)]);

		const full = await BuildRestorePlan(guild, emptySnapshot(31), RESTORE_PRESETS.FULL);
		const rolesOnly = await BuildRestorePlan(guild, emptySnapshot(31), RESTORE_OPTIONS.ROLES);

		expect(rolesOnly).not.toBe(full);
		expect(full.actions.length).toBeGreaterThan(rolesOnly.actions.length);
		expect(rolesOnly.actions.every(a => a.category === RESTORE_OPTIONS.ROLES)).toBe(true);
	});

	it('does not collide on ID prefixes', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE, role(2n, 'Mod')], []);

		// `1:14:7` must not be reachable as `1:142:7` - the key is built from delimited segments
		const short = await BuildRestorePlan(guild, emptySnapshot(14), RESTORE_PRESETS.FULL);
		const long = await BuildRestorePlan(guild, emptySnapshot(142), RESTORE_PRESETS.FULL);

		expect(long).not.toBe(short);
		expect(short.snapshot_id).toBe('14');
		expect(long.snapshot_id).toBe('142');
	});

	it('never expires a plan that keeps being read', async () => {
		// `TTLCache.get` refreshes the expiry on every read, which is exactly why
		// `InvalidateRestorePlans` has to exist - a plan clicked through every few minutes would
		// otherwise compare against itself forever and the staleness check would always pass
		vi.useFakeTimers();
		const guild = makeGuild([BOT_ROLE, EVERYONE, role(2n, 'Mod')], []);

		const first = await BuildRestorePlan(guild, emptySnapshot(32), RESTORE_PRESETS.FULL);

		// The TTL is 15 minutes; read it every 10 for an hour
		for (let i = 0; i < 6; i++) {
			vi.advanceTimersByTime(10 * 60 * 1000);
			expect(GetCachedPlan(GUILD_ID, '32', RESTORE_PRESETS.FULL)).toBe(first);
		}

		// ...but leaving it alone past the TTL does drop it
		vi.advanceTimersByTime(16 * 60 * 1000);
		expect(GetCachedPlan(GUILD_ID, '32', RESTORE_PRESETS.FULL)).toBeNull();
	});
});

describe('InvalidateRestorePlans', () => {
	const guild = makeGuild([BOT_ROLE, EVERYONE, role(2n, 'Mod')], []);
	const otherGuild = makeGuild([BOT_ROLE, role(2n, 'Mod')], [], { id: '2' });

	async function seed() {
		await BuildRestorePlan(guild, emptySnapshot(40), RESTORE_PRESETS.FULL);
		await BuildRestorePlan(guild, emptySnapshot(40), RESTORE_OPTIONS.ROLES);
		await BuildRestorePlan(guild, emptySnapshot(41), RESTORE_PRESETS.FULL);
		await BuildRestorePlan(otherGuild, emptySnapshot(40), RESTORE_PRESETS.FULL);
	}

	it('clears every plan for one guild, leaving other guilds alone', async () => {
		await seed();
		InvalidateRestorePlans(GUILD_ID);

		expect(GetCachedPlan(GUILD_ID, '40', RESTORE_PRESETS.FULL)).toBeNull();
		expect(GetCachedPlan(GUILD_ID, '40', RESTORE_OPTIONS.ROLES)).toBeNull();
		expect(GetCachedPlan(GUILD_ID, '41', RESTORE_PRESETS.FULL)).toBeNull();
		expect(GetCachedPlan('2', '40', RESTORE_PRESETS.FULL)).not.toBeNull();
	});

	it('clears every mask for one snapshot when no mask is given', async () => {
		await seed();
		InvalidateRestorePlans(GUILD_ID, '40');

		expect(GetCachedPlan(GUILD_ID, '40', RESTORE_PRESETS.FULL)).toBeNull();
		expect(GetCachedPlan(GUILD_ID, '40', RESTORE_OPTIONS.ROLES)).toBeNull();
		// A different snapshot in the same guild is a different preview - another admin may be
		// reading it right now
		expect(GetCachedPlan(GUILD_ID, '41', RESTORE_PRESETS.FULL)).not.toBeNull();
	});

	it('clears only the named mask when one is given', async () => {
		await seed();
		InvalidateRestorePlans(GUILD_ID, '40', RESTORE_PRESETS.FULL);

		expect(GetCachedPlan(GUILD_ID, '40', RESTORE_PRESETS.FULL)).toBeNull();
		expect(GetCachedPlan(GUILD_ID, '40', RESTORE_OPTIONS.ROLES)).not.toBeNull();
	});

	it('does not match mask 7 against mask 70', async () => {
		// Masks only reach 15 today, but the key is a string and `...:7` is a prefix of `...:70` -
		// the exact-key branch exists specifically to stop that
		await BuildRestorePlan(guild, emptySnapshot(42), 7);
		await BuildRestorePlan(guild, emptySnapshot(42), 70);

		InvalidateRestorePlans(GUILD_ID, '42', 7);

		expect(GetCachedPlan(GUILD_ID, '42', 7)).toBeNull();
		expect(GetCachedPlan(GUILD_ID, '42', 70)).not.toBeNull();
	});
});

describe('BuildRestorePlan - delete ordering', () => {
	it('deletes child channels before the categories holding them', async () => {
		const category = channel(10n, 'Staff', ChannelType.GuildCategory, null);
		const child = channel(11n, 'mod-log', ChannelType.GuildText, 10n);

		// Category first in the cache, so insertion order alone would put it before its child
		const plan = await BuildRestorePlan(makeGuild([BOT_ROLE, EVERYONE, role(2n, 'Mod')], [category, child]), emptySnapshot(5), RESTORE_PRESETS.FULL);

		const index = (id: bigint) => plan.actions.findIndex(a => a.target_id === id);

		expect(plan.actions.every(a => a.change_type === DIFF_CHANGE_TYPE.DELETE)).toBe(true);
		expect(index(11n)).toBeGreaterThanOrEqual(0);
		expect(index(11n)).toBeLessThan(index(10n));
		// ...and roles come after every channel delete
		expect(index(10n)).toBeLessThan(index(2n));
	});

	it('keeps roles ahead of channels for creates', async () => {
		const snapshot = makeSnapshot(6, [BOT_ROLE, EVERYONE, role(2n, 'Mod')], [channel(10n, 'Staff', ChannelType.GuildCategory, null)]);
		const plan = await BuildRestorePlan(makeGuild([BOT_ROLE, EVERYONE], []), snapshot, RESTORE_PRESETS.FULL);

		const categories = plan.actions.map(a => a.category);
		expect(categories.indexOf(RESTORE_OPTIONS.ROLES)).toBeLessThan(categories.indexOf(RESTORE_OPTIONS.CHANNELS));
	});
});
