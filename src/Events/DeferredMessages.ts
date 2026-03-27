import {EventHandler} from "../Typings/HandlerTypes";
import {Message} from "discord.js";
import { client } from "../Client";

export default {
	name: 'messageUpdate',
	execute: async function(oldMessage: Message<true>, newMessage: Message<true>) {
		// if old message was from a deferred message, count it as a new message
		if (oldMessage.flags.has(128)) client.emit('messageCreate', newMessage);
	}
} as EventHandler;