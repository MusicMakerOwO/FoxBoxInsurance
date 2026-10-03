import { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { IClient } from "../../Client.js";
import { ChannelExport, CreateExportCacheKey } from "../../Typings/CacheEntries.js";
import { InteractionResponse } from "../../Typings/HandlerTypes.js";
import { COLOR } from "../Constants.js";

/** What an export handler returns when its session is gone - clears the dead menu and any attachment */
export const SESSION_EXPIRED_RESPONSE = {
	embeds: [{
		color: COLOR.ERROR,
		description: 'Your session has timed out - Please re-run the command'
	}],
	components: [],
	files: []
} satisfies InteractionResponse;

type SessionInteraction = Pick<ButtonInteraction | ModalSubmitInteraction, 'channelId' | 'user'>;

/** The caller's export session, or null when it has expired - reading it refreshes its TTL */
export function GetExportCache(client: IClient, interaction: SessionInteraction): ChannelExport | null {
	return client.exportCache.get( CreateExportCacheKey(interaction.channelId!, interaction.user.id) );
}
