import {FORMAT} from "../Utils/Constants.js";
import {Channel, User} from "discord.js";
import {ObjectValues} from "./HelperTypes.js";
import { SimpleChannel, SimpleGuild, SimpleMessage, SimpleUser } from "./DatabaseTypes.js";

export function CreateExportCacheKey(channelID: Channel['id'], userID: User['id']): string {
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