import {ButtonHandler} from "../Typings/HandlerTypes.js";

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'close',
	execute       : async function() {
		return { delete: true };
	}
} satisfies ButtonHandler as ButtonHandler;