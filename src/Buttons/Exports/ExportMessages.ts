import {ButtonHandler} from "../../Typings/HandlerTypes.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [],
	response_type : 'modal',
	hidden        : false,
	customID      : 'export-messages',
	execute       : async function() {
		// No session check: a modal has to be shown within Discord's 3 second window and this
		// interaction is never deferred, so there is nothing to render an expiry onto. The modal
		// submit re-reads the session and reports the timeout.
		return {
			title: 'Export Messages',
			custom_id: 'export-messages',
			components: [{
				type: 1,
				components: [{
					type: 4,
					custom_id: 'data',
					label: 'How many messages to export?',
					placeholder: 'Enter a number between 20 and 10,000',
					style: 1,
					min_length: 1,
					max_length: 6,
					required: true
				}]
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;