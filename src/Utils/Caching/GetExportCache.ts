import { ModalSubmitInteraction } from "discord.js";
import { ButtonInteraction } from "discord.js";
import { client } from "../../Client.js";
import { ChannelExport, CreateExportCacheKey } from "../../Typings/CacheEntries.js";
import { COLOR } from "../Constants.js";

export async function GetExportCache(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<ChannelExport | null> {
	const exportOptions = client.exportCache.get( CreateExportCacheKey(interaction.channelId!, interaction.user.id) );
	if (!exportOptions) {
		await interaction.editReply({
			embeds: [{
				color: COLOR.ERROR,
				description: 'Your session has timed out - Please re-run the command'
			}],
			components: [],
			files: []
		});
		return null;
	} else {
		return exportOptions;
	}
}