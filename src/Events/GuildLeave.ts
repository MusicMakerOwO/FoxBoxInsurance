import {Log} from "../Utils/Log";
import {EventHandler} from "../Typings/HandlerTypes";
import {Guild} from "discord.js";

export default {
	name: 'guildDelete',
	execute: async function(guild: Guild) {
		Log('ERROR', `Left guild: ${guild.name} (${guild.id})`);
	}
} as EventHandler;