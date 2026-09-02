import { describe, it, expect, vi, afterEach } from 'vitest';
import { ChannelType } from 'discord.js';
import { DIFF_CHANGE_TYPE, RESTORE_OPTIONS, RESTORE_PRESETS } from '../../Utils/Constants.js';
import { BOT_ROLE, BOT_USER_ID, EVERYONE, GUILD_ID, ban, channel, makeGuild, makeSnapshot, role } from './Fixtures.js';
import type { RestoreAction } from '../../Services/RestorePlans.js';

vi.mock('../../Client.js', () => ({ client: { user: { id: BOT_USER_ID } } }));

const { BuildRestorePlan, InvalidateRestorePlans } = await import('../../Services/RestorePlans.js');

afterEach(() => InvalidateRestorePlans(GUILD_ID));

/**
 * One fixture that lands in all eleven rank buckets at once, so an ordering regression in any single
 * bucket shows up rather than being hidden by an absent neighbour. Every ID is unique per bucket:
 *
 * role +4n / role ~2n / role -3n, category +22n / ~20n / -21n, channel +32n / ~30n / -31n,
 * ban +70n / -71n.
 */
const LIVE_ROLES = [BOT_ROLE, EVERYONE, role(2n, 'Mod', { color: 0x000001 }), role(3n, 'Gone')];
const SNAPSHOT_ROLES = [BOT_ROLE, EVERYONE, role(2n, 'Mod', { color: 0x0000ff }), role(4n, 'New', { position: 4 })];

const LIVE_CHANNELS = [
	channel(20n, 'Staff', ChannelType.GuildCategory, null),
	channel(21n, 'Archive', ChannelType.GuildCategory, null),
	channel(30n, 'mod-log', ChannelType.GuildText, 20n),
	channel(31n, 'old-log', ChannelType.GuildText, 21n)
];
const SNAPSHOT_CHANNELS = [
	channel(20n, 'Staff Room', ChannelType.GuildCategory, null),
	channel(22n, 'Events', ChannelType.GuildCategory, null),
	channel(30n, 'mod-logs', ChannelType.GuildText, 20n),
	channel(32n, 'signups', ChannelType.GuildText, 22n)
];

const LIVE_BANS = [ban(71n)];
const SNAPSHOT_BANS = [ban(70n)];

let nextSnapshotID = 200;

function buildPlan(order: <T>(items: T[]) => T[] = items => items) {
	const guild = makeGuild(order(LIVE_ROLES), order(LIVE_CHANNELS), { bans: order(LIVE_BANS) });
	const snapshot = makeSnapshot(nextSnapshotID++, order(SNAPSHOT_ROLES), order(SNAPSHOT_CHANNELS), order(SNAPSHOT_BANS));
	return BuildRestorePlan(guild, snapshot, RESTORE_PRESETS.FULL);
}

const isRole    = (a: RestoreAction) => a.category === RESTORE_OPTIONS.ROLES;
const isChannel = (a: RestoreAction) => a.category === RESTORE_OPTIONS.CHANNELS;
const isDelete  = (a: RestoreAction) => a.change_type === DIFF_CHANGE_TYPE.DELETE;

describe('BuildRestorePlan - apply order', () => {
	it('emits the canonical eleven-bucket sequence', async () => {
		const plan = await buildPlan();

		// roles +/~, categories +/~, channels +/~, bans +, then the deletes inside-out:
		// channels, categories, roles, bans
		expect(plan.actions.map(a => a.target_id)).toEqual([4n, 2n, 22n, 20n, 32n, 30n, 70n, 31n, 21n, 3n, 71n]);
	});

	it('never places a delete before a create or update in the same category', async () => {
		// Shuffled inputs, because the sort key is the only thing standing between an insertion order
		// and a run that deletes a category before recreating its replacement
		for (let seed = 0; seed < 25; seed++) {
			const plan = await buildPlan(items => [...items].sort(() => Math.random() - 0.5));

			for (const category of [RESTORE_OPTIONS.ROLES, RESTORE_OPTIONS.CHANNELS, RESTORE_OPTIONS.BANS]) {
				const inCategory = plan.actions.filter(a => a.category === category);
				const firstDelete = inCategory.findIndex(isDelete);
				if (firstDelete === -1) continue;

				expect(inCategory.slice(firstDelete).every(isDelete)).toBe(true);
			}
		}
	});

	it('finishes every role write before touching a channel', async () => {
		// Channel overwrites reference roles by ID, so a channel written first would silently drop
		// the overwrites for roles that do not exist yet
		const plan = await buildPlan();

		const lastRoleWrite = plan.actions.findLastIndex(a => isRole(a) && !isDelete(a));
		const firstChannel = plan.actions.findIndex(isChannel);

		expect(lastRoleWrite).toBeGreaterThanOrEqual(0);
		expect(lastRoleWrite).toBeLessThan(firstChannel);
	});

	it('creates categories before their children and deletes them after', async () => {
		const plan = await buildPlan();
		const index = (id: bigint) => plan.actions.findIndex(a => a.target_id === id);

		// A child created first has nowhere to go but the server root
		expect(index(22n)).toBeLessThan(index(32n));
		// ...and a category deleted first reparents its children to the root in front of everyone,
		// permanently if the run never finishes (Bug #16)
		expect(index(31n)).toBeLessThan(index(21n));
	});

	it('leaves ban removals until last', async () => {
		// Unbanning is the one action that lets someone back in, so it happens once the server is
		// already in its restored shape
		const plan = await buildPlan();

		expect(plan.actions.at(-1)!.target_id).toBe(71n);
	});

	it('is stable within a rank', async () => {
		// Two roles in the same bucket, so only insertion order can separate them. An unstable sort
		// would make the fingerprint's tie-break arbitrary and previews reshuffle between clicks
		const guild = makeGuild([BOT_ROLE, EVERYONE], []);
		const roles = [BOT_ROLE, EVERYONE, role(4n, 'Alpha', { position: 4 }), role(5n, 'Beta', { position: 5 })];

		const forward = await BuildRestorePlan(guild, makeSnapshot(300, roles, []), RESTORE_PRESETS.FULL);
		InvalidateRestorePlans(GUILD_ID);
		const again = await BuildRestorePlan(guild, makeSnapshot(300, roles, []), RESTORE_PRESETS.FULL);
		InvalidateRestorePlans(GUILD_ID);
		const reversed = await BuildRestorePlan(guild, makeSnapshot(300, [...roles].reverse(), []), RESTORE_PRESETS.FULL);

		expect(forward.actions.map(a => a.target_id)).toEqual([4n, 5n]);
		expect(again.actions.map(a => a.target_id)).toEqual([4n, 5n]);
		expect(reversed.actions.map(a => a.target_id)).toEqual([5n, 4n]);
	});
});
