import {SelectMenuHandler} from "../Typings/HandlerTypes";
import {ButtonInteraction} from "discord.js";
import { TOS_FEATURES } from "../TOSConstants";
import { GUILD_FEATURES } from "../Typings/DatabaseTypes";

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.MANAGE_SNAPSHOTS ],
	permissions   : [],
	response_type : 'update',
	hidden        : true,
	customID      : 'snapshot-view',
	execute       : async function(interaction, client) {
		const snapshotID = interaction.values[0];
		const button = client.buttons.get('snapshot-manage')!;
		return button.execute(interaction as unknown as ButtonInteraction, client, [snapshotID]);
	}
} satisfies SelectMenuHandler as SelectMenuHandler;