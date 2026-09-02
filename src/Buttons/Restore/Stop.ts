import { ButtonHandler } from "../../Typings/HandlerTypes.js";
import { COLOR, EMOJI } from "../../Utils/Constants.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";
import { RequestStop } from "../../Services/RestoreRunner.js";

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.RESTORE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	// Deliberately not 'update': the runner owns the step log message and re-renders it on a timer,
	// so replying here instead of updating keeps the two from fighting over it
	response_type : 'reply',
	hidden        : true,
	customID      : 'restore-stop',
	execute       : async function(interaction, client, args) {
		const restoreID = parseInt(args[0]);

		if (!RequestStop(restoreID, interaction.guildId!)) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'Nothing To Stop',
					description: 'That restore has already finished. The log message shows what was applied.'
				}]
			}
		}

		return {
			embeds: [{
				color: COLOR.PRIMARY,
				title: `${EMOJI.STOP} Stopping Restore`,
				description: `
I'll finish the action already in flight and skip the rest.

**This leaves the server half restored.** The log message will show what was applied and which snapshot rolls it back.`
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;
