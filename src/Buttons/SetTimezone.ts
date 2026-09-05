import { ButtonHandler } from "../Typings/HandlerTypes.js";
import { GetTimezone } from "../CRUD/UserTimezones.js";
import { TimezoneLabel } from "../Utils/Timezones.js";

export default {
	tos_features: [],
	guild_features: [],
	permissions: [],
	response_type: 'modal',
	hidden: false,
	customID: 'set-timezone',
	execute: async function (interaction, client, args) {
		const currentTimezone = await GetTimezone(interaction.user.id);
		const pretty = TimezoneLabel(currentTimezone);

		return {
			title: 'Set Your Timezone',
			custom_id: `set-timezone_${args.join('_')}`,
			components: [{
				type: 1,
				components: [{
					type: 4,
					custom_id: 'data',
					label: 'Timezone',
					style: 1,
					placeholder: 'EST, UTC+2, Europe/London...',
					value: pretty,
					required: true
				}]
			}]
		};
	}
} satisfies ButtonHandler as ButtonHandler;