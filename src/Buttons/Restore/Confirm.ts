import { ButtonHandler } from "../../Typings/HandlerTypes.js";
import { DIFF_CHANGE_TYPE } from "../../Utils/Constants.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";
import { GetCachedPlan } from "../../Services/RestorePlans.js";

const MAX_MODAL_TITLE_LENGTH = 45;
const MAX_LABEL_DESCRIPTION_LENGTH = 100;

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.RESTORE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'modal',
	hidden        : false,
	customID      : 'restore-confirm',
	execute       : async function(interaction, client, args) {
		const [id, maskArg] = args;
		const mask = parseInt(maskArg) || 0;

		// Read-only and synchronous by necessity: a modal has to be shown within Discord's 3 second
		// window, and a `response_type: 'modal'` handler has no deferred reply to fall back on, so
		// it cannot rebuild the plan or render an error embed. Everything that can refuse is
		// re-checked in Modals/RestoreStart.ts, including the case where this cache has expired.
		const plan = GetCachedPlan(interaction.guildId!, id, mask);
		const totalActions = plan?.actions.length ?? 0;
		const totalDestructive = plan?.actions.filter(action => action.change_type === DIFF_CHANGE_TYPE.DELETE).length ?? 0;

		const title = plan
			? `Confirm restore - ${totalActions} action${totalActions === 1 ? '' : 's'}`
			: 'Confirm restore';

		const description = plan && totalDestructive > 0
			? `${totalDestructive} destructive. Type: ${interaction.guild!.name}`
			: `Type the server name exactly: ${interaction.guild!.name}`;

		return {
			title: title.slice(0, MAX_MODAL_TITLE_LENGTH),
			custom_id: `restore-start_${id}_${mask}`,
			components: [{
				type: 18,
				label: 'Server name',
				description: description.slice(0, MAX_LABEL_DESCRIPTION_LENGTH),
				component: {
					type: 4,
					custom_id: 'data',
					style: 1, // short
					required: true,
					max_length: 100 // guild names cap at 100
				}
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;