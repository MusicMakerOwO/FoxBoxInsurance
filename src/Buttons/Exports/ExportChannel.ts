import {ButtonHandler} from "../../Typings/HandlerTypes.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [],
	response_type : 'modal',
	hidden        : false,
	customID      : 'export-channel',
	execute       : async function() {
		// No session check: a modal has to be shown within Discord's 3 second window and this
		// interaction is never deferred, so there is nothing to render an expiry onto. The modal
		// submit re-reads the session and reports the timeout.
		return {
			title: 'Export Channel',
			custom_id: 'export-channel',
			components: [{
				type: 18,
				label: 'Select the channel to export from',
				component: {
					type: 8,
					custom_id: 'data',
					required: true
				}
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;