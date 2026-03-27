import {GetExportCache} from "../Utils/Caching/GetExportCache";
import {Database} from "../Database";
import { InteractionResponse, ModalHandler } from "../Typings/HandlerTypes";
import {ButtonInteraction} from "discord.js";
import {CreateExportCacheKey} from "../Typings/CacheEntries";
import { TOS_FEATURES } from "../TOSConstants";
import { GUILD_FEATURES } from "../Typings/DatabaseTypes";

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'export-messages',
	execute       : async function(interaction, client) {

		const input = interaction.fields.getTextInputValue('data');

		const cleanInput = input.replace(/\D/g, ''); // 10,000 -> 10000
		const inputNumber = Math.max(20, Math.min(10_000, parseInt(cleanInput))); // [1, 10_000]

		// @ts-expect-error
		const exportOptions = await GetExportCache(interaction);
		if (!exportOptions) return {};

		const channelMessageCount = await Database.query('SELECT COUNT(*) as count FROM Messages WHERE channel_id = ?', [exportOptions.channelID]).then(x => x[0].count) as bigint;

		exportOptions.messageCount = Math.min(inputNumber, Number(channelMessageCount));

		client.exportCache.set(
			CreateExportCacheKey(interaction.channelId!, interaction.user.id),
			exportOptions
		);

		const main = client.buttons.get('export-main')!;
		return await main.execute(interaction as unknown as ButtonInteraction, client, []) as InteractionResponse;
	}
} satisfies ModalHandler as ModalHandler;