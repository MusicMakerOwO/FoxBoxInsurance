import { GetExportCache, SESSION_EXPIRED_RESPONSE } from "../Utils/Caching/GetExportCache.js";
import {Database} from "../Database.js";
import { InteractionResponse, ModalHandler } from "../Typings/HandlerTypes.js";
import {ButtonInteraction} from "discord.js";
import {CreateExportCacheKey} from "../Typings/CacheEntries.js";
import { TOS_FEATURES } from "../TOSConstants.js";
import { GUILD_FEATURES } from "../Typings/DatabaseTypes.js";
import { COLOR, EMOJI } from "../Utils/Constants.js";

const MIN_MESSAGES = 20;
const MAX_MESSAGES = 10_000;

/** An ephemeral follow-up, leaving the export menu as it was so the user can try again */
function Refuse(reason: string): InteractionResponse {
	return {
		followUp: {
			embeds: [{
				color: COLOR.ERROR,
				description: `${EMOJI.WARNING} ${reason}`
			}]
		}
	};
}

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'export-messages',
	execute       : async function(interaction, client) {

		// Validated before the session is read, so a typo never costs the user their export menu
		const digits = interaction.fields.getTextInputValue('data').replace(/\D/g, ''); // 10,000 -> 10000
		if (digits === '') return Refuse('Please enter a number of messages to export');

		const targetMessageCount = parseInt(digits);
		if (targetMessageCount < MIN_MESSAGES) return Refuse(`Cannot export less than ${MIN_MESSAGES} messages`);
		if (targetMessageCount > MAX_MESSAGES) return Refuse(`Cannot export more than 10,000 messages`);

		const exportOptions = GetExportCache(client, interaction);
		if (!exportOptions) return SESSION_EXPIRED_RESPONSE;

		const channelMessageCount = await Database.query('SELECT COUNT(*) as count FROM Messages WHERE channel_id = ?', [exportOptions.channelID]).then(x => x[0].count) as bigint;

		exportOptions.messageCount = Math.min(targetMessageCount, Number(channelMessageCount));

		client.exportCache.set(
			CreateExportCacheKey(interaction.channelId!, interaction.user.id),
			exportOptions
		);

		const main = client.buttons.get('export-main')!;
		return await main.execute(interaction as unknown as ButtonInteraction, client, []) as InteractionResponse;
	}
} satisfies ModalHandler as ModalHandler;