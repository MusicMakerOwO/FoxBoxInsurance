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
		const opt = args[0];
		if (opt !== "in" && opt !== "out") throw new Error(`Invalid data collection choice '${opt}'`);

		const savedUser = await GetUser(interaction.user.id);
		if (!savedUser) throw new Error('User ID does not exist or cannot be accessed');
		// A copy, so a failed save doesn't leave the cached user saying something the database doesn't
		await SaveUser({ ...savedUser, opt_out_collection: opt === "out" ? 1 : 0 });

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