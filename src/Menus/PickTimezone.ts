import { InteractionResponse, SelectMenuHandler } from "../Typings/HandlerTypes.js";
import { SetTimezone } from "../CRUD/UserTimezones.js";
import { ResolveTimezone } from "../Utils/Timezones.js";
import { COLOR } from "../Utils/Constants.js";
import { ButtonInteraction } from "discord.js";

/**
 * Stores the zone a user picked from the disambiguation menu that `Modals/SetTimezone.ts` puts up,
 * then re-renders the activity chart they came from.
 */
export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'pick-timezone',
	execute       : async function(interaction, client, args) {
		// The value came from a menu we built, but it still arrives from the client, so it goes through
		// the same resolution as typed input rather than straight into the database
		const resolution = ResolveTimezone(interaction.values[0]);
		if (resolution.kind !== 'resolved') {
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'Unknown timezone',
					description: 'That option is no longer valid - open the timezone menu again.'
				}]
			};
		}

		await SetTimezone(interaction.user.id, resolution.zone);
		const button = client.buttons.get('activity')!;
		return await button.execute(interaction as unknown as ButtonInteraction, client, args) as InteractionResponse;
	}
} satisfies SelectMenuHandler as SelectMenuHandler;
