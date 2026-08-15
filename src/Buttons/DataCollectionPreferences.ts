import {ButtonHandler} from "../Typings/HandlerTypes.js";
import {COLOR} from "../Utils/Constants.js";
import { GetUser, SaveUser } from "../CRUD/Users.js";

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'update',
	hidden        : true,
	customID      : 'data-collection',
	execute       : async function(interaction, client, args) {
		const opt = args[0] as "in" | "out";

		const savedUser = (await GetUser(interaction.user.id))!;
		savedUser.opt_out_collection = opt === "out" ? 1 : 0;
		void SaveUser(savedUser);

		if (opt === "out") {
			return {
				embeds: [{
					color: COLOR.PRIMARY,
					description: `
You have **opted out** of data collection.
All future messages will be redacted.`
				}],
				components: []
			}
		} else {
			return {
				embeds: [{
					color: COLOR.PRIMARY,
					description: `
You have **opted in** to data collection.
All future messages will be saved as normal.`
				}],
				components: []
			}
		}
	}
} satisfies ButtonHandler as ButtonHandler;