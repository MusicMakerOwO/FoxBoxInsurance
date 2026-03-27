import {ButtonHandler} from "../Typings/HandlerTypes";

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'close',
	execute       : async function(interaction) {
		void interaction.deleteReply();
		return {};
	}
} satisfies ButtonHandler as ButtonHandler;