import { describe, it, expect, vi } from 'vitest';

vi.mock('../CRUD/Guilds.js', () => ({ SaveGuild: vi.fn(async () => {}) }));

import { GetFeatureFlag, SetFeatureFlag } from '../Services/GuildFeatures.js';
import { GUILD_FEATURES, SimpleGuild } from '../Typings/DatabaseTypes.js';

function makeGuild(features = 0): SimpleGuild {
	return { id: 1n, name: 'Test Guild', features, last_restore: 0n };
}

describe('GetFeatureFlag', () => {
	it('returns false when no flags are set', () => {
		expect(GetFeatureFlag(makeGuild(0), GUILD_FEATURES.MESSAGE_HISTORY)).toBe(false);
	});

	it('returns true when the flag is set', () => {
		expect(GetFeatureFlag(makeGuild(GUILD_FEATURES.MESSAGE_HISTORY), GUILD_FEATURES.MESSAGE_HISTORY)).toBe(true);
	});

	it('returns false for a flag not set when other flags are set', () => {
		const guild = makeGuild(GUILD_FEATURES.AUTOMATIC_SNAPSHOTS | GUILD_FEATURES.EXPORT_MESSAGES);
		expect(GetFeatureFlag(guild, GUILD_FEATURES.MESSAGE_HISTORY)).toBe(false);
	});
});

describe('SetFeatureFlag', () => {
	it('sets the flag when enabled is true', () => {
		const guild = makeGuild(0);
		SetFeatureFlag(guild, GUILD_FEATURES.MESSAGE_HISTORY, true);
		expect(GetFeatureFlag(guild, GUILD_FEATURES.MESSAGE_HISTORY)).toBe(true);
	});

	it('clears the flag when enabled is false', () => {
		const guild = makeGuild(GUILD_FEATURES.MESSAGE_HISTORY);
		SetFeatureFlag(guild, GUILD_FEATURES.MESSAGE_HISTORY, false);
		expect(GetFeatureFlag(guild, GUILD_FEATURES.MESSAGE_HISTORY)).toBe(false);
	});

	it('does not affect other flags when setting a flag', () => {
		const guild = makeGuild(GUILD_FEATURES.EXPORT_MESSAGES);
		SetFeatureFlag(guild, GUILD_FEATURES.MESSAGE_HISTORY, true);
		expect(guild.features).toBe(GUILD_FEATURES.EXPORT_MESSAGES | GUILD_FEATURES.MESSAGE_HISTORY);
	});

	it('does not affect other flags when clearing a flag', () => {
		const guild = makeGuild(GUILD_FEATURES.EXPORT_MESSAGES | GUILD_FEATURES.MESSAGE_HISTORY);
		SetFeatureFlag(guild, GUILD_FEATURES.MESSAGE_HISTORY, false);
		expect(guild.features).toBe(GUILD_FEATURES.EXPORT_MESSAGES);
	});
});
