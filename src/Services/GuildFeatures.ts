import { GUILD_FEATURES, SimpleGuild } from "../Typings/DatabaseTypes.js";
import { ObjectValues } from "../Typings/HelperTypes.js";
import { SaveGuild } from "../CRUD/Guilds.js";

export function GetFeatureFlag(guild: SimpleGuild, flag: ObjectValues<typeof GUILD_FEATURES>): boolean {
	return !!(guild.features & flag);
}

/**
 * Mutates the guild in place and saves the updated copy via SaveGuild()
 *
 * Additionally, the function is called with `void` with the assumption you will not read the guild a second time
 * immediately afterwords (you already passed it into this function lol)
 */
export function SetFeatureFlag(guild: SimpleGuild, flag: ObjectValues<typeof GUILD_FEATURES>, enabled: boolean): void {
	if (enabled) {
		guild.features |= flag;
	} else {
		guild.features &= ~flag;
	}
	void SaveGuild(guild);
}