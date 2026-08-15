import {Log} from "../Utils/Log.js";
import {EventHandler} from "../Typings/HandlerTypes.js";
import {Guild} from "discord.js";

export default {
	name: 'guildDelete',
	execute: async function(guild: Guild) {
		Log('ERROR', `Left guild: ${guild.name} (${guild.id})`);
	}
} as EventHandler;