import { InteractionResponse, SelectMenuHandler } from "../Typings/HandlerTypes.js";
import { SetTimezone } from "../CRUD/UserTimezones.js";
import { ResolveTimezone } from "../Utils/Timezones.js";
import { COLOR } from "../Utils/Constants.js";
import { IsActivitySpan } from "../Buttons/Activity.js";
import { TryAgainRow } from "../Modals/SetTimezone.js";
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
		// Refused before the zone is stored rather than by the chart afterwards
		if (!IsActivitySpan(args[0])) throw new Error(`Invalid time interval: ${args[0]}`);

		// The value came from a menu we built, but it still arrives from the client, so it goes through
		// the same resolution as typed input rather than straight into the database
		const resolution = ResolveTimezone(interaction.values[0] ?? '');
		if (resolution.kind !== 'resolved') {
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'Unknown timezone',
					description: 'That option is no longer valid - enter your timezone again.'
				}],
				files: [],
				components: [TryAgainRow(args)]
			};
		}

		await SetTimezone(interaction.user.id, resolution.zone);
		const button = client.buttons.get('activity')!;
		return await button.execute(interaction as unknown as ButtonInteraction, client, args) as InteractionResponse;
	}
} satisfies SelectMenuHandler as SelectMenuHandler;
