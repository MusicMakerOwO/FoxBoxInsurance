import {EventHandler} from "../Typings/HandlerTypes.js";
import {Log} from "../Utils/Log.js";
import {Guild} from "discord.js";

export default {
	name: 'guildCreate',
	execute: async function(guild: Guild) {
		Log('TRACE', `Joined new guild: ${guild.name} (${guild.id})`);
	}
} as EventHandler;