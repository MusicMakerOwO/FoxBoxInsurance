import { describe, it, expect, vi } from "vitest";
vi.mock("../CRUD/Guilds", () => ({
	SaveGuild: vi.fn(() => Promise.resolve())
}));

import { GetFeatureFlag, SetFeatureFlag } from "../Services/GuildFeatures";
import { GUILD_FEATURES, SimpleGuild } from "../Typings/DatabaseTypes";
import * as Guilds from "../CRUD/Guilds";

import * as dotenv from "dotenv";
dotenv.config({ path: `${__dirname}/../../.env`, quiet: true });

function createGuild(features = 0): SimpleGuild {
	return { id: 1n, name: "Test", last_restore: 0n, features } as SimpleGuild;
}

describe("GetFeatureFlag", () => {
	it("returns false when no flags are set", () => {
		const guild = createGuild(0);
		expect(GetFeatureFlag(guild, GUILD_FEATURES.EXPORT_MESSAGES)).toBe(false);
	});

	it("returns true when the flag is set", () => {
		const guild = createGuild(GUILD_FEATURES.EXPORT_MESSAGES);
		expect(GetFeatureFlag(guild, GUILD_FEATURES.EXPORT_MESSAGES)).toBe(true);
	});

	it("returns false for a flag not set when other flags are set", () => {
		const guild = createGuild(GUILD_FEATURES.EXPORT_MESSAGES | GUILD_FEATURES.MESSAGE_SAVING);
		expect(GetFeatureFlag(guild, GUILD_FEATURES.AUTOMATIC_SNAPSHOTS)).toBe(false);
	});
});

describe("SetFeatureFlag", () => {
	const saveGuildSpy = vi.spyOn(Guilds, "SaveGuild");

	it("sets the flag when enabled is true", () => {
		const guild = createGuild(0);
		SetFeatureFlag(guild, GUILD_FEATURES.EXPORT_MESSAGES, true);
		expect(guild.features & GUILD_FEATURES.EXPORT_MESSAGES).not.toBe(0);
		expect(saveGuildSpy).toHaveBeenCalledWith(guild);
	});

	it("clears the flag when enabled is false", () => {
		const guild = createGuild(GUILD_FEATURES.EXPORT_MESSAGES);
		SetFeatureFlag(guild, GUILD_FEATURES.EXPORT_MESSAGES, false);
		expect(guild.features & GUILD_FEATURES.EXPORT_MESSAGES).toBe(0);
		expect(saveGuildSpy).toHaveBeenCalledWith(guild);
	});

	it("does not affect other flags when setting a flag", () => {
		const guild = createGuild(GUILD_FEATURES.EXPORT_MESSAGES | GUILD_FEATURES.MESSAGE_SAVING);
		SetFeatureFlag(guild, GUILD_FEATURES.AUTOMATIC_SNAPSHOTS, true);
		expect(guild.features & GUILD_FEATURES.EXPORT_MESSAGES).not.toBe(0);
		expect(guild.features & GUILD_FEATURES.MESSAGE_SAVING).not.toBe(0);
		expect(guild.features & GUILD_FEATURES.AUTOMATIC_SNAPSHOTS).not.toBe(0);
	});

	it("does not affect other flags when clearing a flag", () => {
		const guild = createGuild(GUILD_FEATURES.EXPORT_MESSAGES | GUILD_FEATURES.MESSAGE_SAVING);
		SetFeatureFlag(guild, GUILD_FEATURES.EXPORT_MESSAGES, false);
		expect(guild.features & GUILD_FEATURES.EXPORT_MESSAGES).toBe(0);
		expect(guild.features & GUILD_FEATURES.MESSAGE_SAVING).not.toBe(0);
	});

	saveGuildSpy.mockRestore();
});