import {EventHandler} from "../Typings/HandlerTypes";
import {Log} from "../Utils/Log";
import {Guild} from "discord.js";

export default {
	name: 'guildCreate',
	execute: async function(guild: Guild) {
		Log('TRACE', `Joined new guild: ${guild.name} (${guild.id})`);
	}
} as EventHandler;