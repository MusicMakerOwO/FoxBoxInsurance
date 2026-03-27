import {FORMAT} from "../Utils/Constants";
import {Channel, User} from "discord.js";
import {ObjectValues} from "./HelperTypes";
import { SimpleChannel, SimpleGuild, SimpleMessage, SimpleUser } from "./DatabaseTypes";

export function CreateExportCacheKey(channelID: Channel['id'], userID: User['id']) {
	return channelID + ':' + userID;
}
export type ChannelExport = {
	guildID: SimpleGuild['id'],
	channelID: SimpleChannel['id'],
	userID: SimpleUser['id'],
	format: ObjectValues<typeof FORMAT>,
	messageCount: number,
	lastMessageID: SimpleMessage['id']
}