import { SelectMenuHandler } from "../Typings/HandlerTypes.js";
import { ButtonInteraction } from "discord.js";
import { TOS_FEATURES } from "../TOSConstants.js";
import { GUILD_FEATURES } from "../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../Utils/DiscordConstants.js";

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.RESTORE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : true,
	customID      : 'restore-category',
	execute       : async function(interaction, client, args) {
		const [id, mask] = args;
		const category = interaction.values[0];

		const button = client.buttons.get('restore-actions')!;
		return button.execute(interaction as unknown as ButtonInteraction, client, [id, mask, category, '0', '']);
	}
} satisfies SelectMenuHandler as SelectMenuHandler;
