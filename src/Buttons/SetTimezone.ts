import { ButtonHandler } from "../Typings/HandlerTypes.js";
import { GetTimezone, IANAToTimezone } from "../CRUD/UserTimezones.js";

export default {
	tos_features: [],
	guild_features: [],
	permissions: [],
	response_type: 'modal',
	hidden: false,
	customID: 'set-timezone',
	execute: async function (interaction, client, args) {
		const currentTimezone = await GetTimezone(interaction.user.id);
		const pretty = IANAToTimezone(currentTimezone);

		return {
			title: 'Set Your Timezone',
			custom_id: `set-timezone_${args.join('_')}`,
			components: [{
				type: 1,
				components: [{
					type: 4,
					custom_id: 'data',
					label: 'Timezone (EST, GMT, etc.)',
					style: 1,
					placeholder: 'Enter a timezone...',
					value: pretty,
					required: true
				}]
			}]
		};
	}
} satisfies ButtonHandler as ButtonHandler;