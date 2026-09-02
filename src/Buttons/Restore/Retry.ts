import { ButtonHandler } from "../../Typings/HandlerTypes.js";
import { COLOR, EMOJI, RESTORE_RESULT, RESTORE_STATUS } from "../../Utils/Constants.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";
import { GetRestoreActions, GetRestoreRun, ReopenRestoreRun } from "../../CRUD/SnapshotRestores.js";
import { ClaimRestoreLock, ReleaseRestoreLock, RetryRestore, RunLabel } from "../../Services/RestoreRunner.js";
import { Log } from "../../Utils/Log.js";

function Refuse(title: string, description: string) {
	return { embeds: [{ color: COLOR.ERROR, title, description }] };
}

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.RESTORE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	// Deliberately not 'update': the runner owns the step log this button sits on and re-renders it
	// on a timer, so replying here keeps the two from fighting over the message
	response_type : 'reply',
	hidden        : true,
	customID      : 'restore-retry',
	execute       : async function(interaction, client, args) {
		const restoreID = parseInt(args[0]);
		const record = await GetRestoreRun(restoreID);

		// `GetRestoreRun` looks up by ID alone, so the guild check happens here - a run ID is
		// guessable and this button re-applies writes to a server
		if (!record || String(record.guild_id) !== interaction.guildId) {
			return Refuse('Restore Not Found', 'That restore does not exist, or it belongs to a different server.');
		}

		if (record.status !== RESTORE_STATUS.FAILED) {
			return Refuse('Nothing To Retry', `Retry only replays actions that failed. Restore #${restoreID} did not end with failures - restore ${RunLabel(record)} again to apply anything still outstanding.`);
		}

		const failed = await GetRestoreActions(restoreID, RESTORE_RESULT.FAILED);
		if (failed.length === 0) {
			return Refuse('Nothing To Retry', 'Every action in that restore has since been resolved. There is nothing left to replay.');
		}

		// Claimed before the first await below so two clicks landing together cannot both start a run
		if (!ClaimRestoreLock(interaction.guildId!)) {
			return Refuse('Restore In Progress', 'This server is already being restored. Wait for that run to finish before retrying.');
		}

		try {
			// Back to RUNNING for the duration, so a crash mid-retry is reconciled at the next startup
			await ReopenRestoreRun(restoreID);
		} catch (error) {
			Log('ERROR', error);
			ReleaseRestoreLock(interaction.guildId!);
			return Refuse('Could Not Start Retry', 'I could not reopen that restore. Nothing has been changed - try again in a moment.');
		}

		// Fire and forget - a retry runs for minutes and cannot be awaited inside an interaction
		// handler. `RetryRestore` releases the lock claimed above when it settles
		void RetryRestore(restoreID, interaction.guildId!).catch(Log.bind(null, 'ERROR'));

		return {
			embeds: [{
				color: COLOR.PRIMARY,
				title: `${EMOJI.RESTORE} Retrying Restore`,
				description: `
Replaying **${failed.length}** failed action${failed.length === 1 ? '' : 's'} from Restore #${restoreID}.

These are the same actions you already confirmed - nothing is re-planned against the server as it is now, so no new actions can appear. Progress is posted back to the original restore log.`
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;
