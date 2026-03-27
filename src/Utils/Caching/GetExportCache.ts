import { ModalSubmitInteraction } from "discord.js";
import { ButtonInteraction } from "discord.js";
import { client } from "../../Client";
import { CreateExportCacheKey } from "../../Typings/CacheEntries";
import { COLOR } from "../Constants";

export async function GetExportCache(interaction: ButtonInteraction | ModalSubmitInteraction) {
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