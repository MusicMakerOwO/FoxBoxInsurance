import { InteractionResponse, ModalHandler } from "../Typings/HandlerTypes.js";
import { COLOR, EMOJI, RESTORE_STATUS, SNAPSHOT_TYPE } from "../Utils/Constants.js";
import { TOS_FEATURES } from "../TOSConstants.js";
import { GUILD_FEATURES } from "../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../Utils/DiscordConstants.js";
import { GetGuildSnapshot } from "../Services/SnapshotLookup.js";
import { CreateSnapshot, SetSnapshotPinStatus } from "../CRUD/Snapshots.js";
import { CreateRestoreRun, FinishRestoreRun, SetRestoreMessage } from "../CRUD/SnapshotRestores.js";
import { BuildRestorePlan, GetCachedPlan, InvalidateRestorePlans, RestorePlanError } from "../Services/RestorePlans.js";
import { ClaimRestoreLock, IsRestoreRunning, ReleaseRestoreLock, RunRestore } from "../Services/RestoreRunner.js";
import { SnapshotLabel } from "../Utils/Snapshots/SnapshotLabel.js";
import { Log } from "../Utils/Log.js";

function Refuse(title: string, description: string): InteractionResponse {
	return { embeds: [{ color: COLOR.ERROR, title, description }] };
}

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.RESTORE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'reply',
	hidden        : true,
	customID      : 'restore-start',
	execute       : async function(interaction, client, args) {
		const [id, maskArg] = args;
		const mask = parseInt(maskArg) || 0;
		const guild = interaction.guild!;

		// Everything that can refuse runs before anything that mutates. This reply is ephemeral, so
		// a refusal leaves the preview message untouched and the admin can retry without redoing
		// the scope.

		const typedName = interaction.fields.getTextInputValue('data').trim().toLowerCase();
		if (typedName !== guild.name.trim().toLowerCase()) {
			return Refuse('Name Did Not Match', `That is not this server's name, so nothing has been changed.\nYour preview is still open - press restore again when you're ready.`);
		}

		if (IsRestoreRunning(guild.id)) {
			return Refuse('Restore In Progress', 'This server is already being restored. Wait for that run to finish before starting another.');
		}

		const snapshotData = await GetGuildSnapshot(guild.id, id);
		if (!snapshotData) {
			return Refuse('Snapshot Not Found', `Snapshot not found or already deleted\nCreate one using \`/snapshot create\``);
		}

		// The plan was computed when the preview was rendered but is applied now. Rebuild it and
		// compare - if the numbers moved, someone changed the server in between and this admin
		// never actually confirmed the actions that would run.
		const previewed = GetCachedPlan(guild.id, id, mask);
		if (!previewed) {
			return Refuse('Preview Expired', 'Your preview is too old to confirm safely. Open the restore menu again to see the current numbers.');
		}

		// Only this scope - a snapshot-wide eviction would also drop the preview another admin is
		// reading on a different mask and send them to "Preview Expired" for no reason
		InvalidateRestorePlans(guild.id, id, mask);

		let plan;
		try {
			plan = await BuildRestorePlan(guild, snapshotData, mask);
		} catch (error) {
			if (error instanceof RestorePlanError) return Refuse('Could Not Build Restore Plan', error.message);
			throw error;
		}

		if (plan.fingerprint !== previewed.fingerprint) {
			// `BuildRestorePlan` caches what it just built. Left there, a second press of Restore
			// would find that plan, match its own fingerprint and apply actions nobody reviewed -
			// so evict it and make the next attempt start from a fresh preview
			InvalidateRestorePlans(guild.id, id, mask);

			return Refuse('The Server Changed', `Something changed in this server while you were reading the preview, so the plan you confirmed is out of date.\nNothing has been changed - open the restore menu again to review the new plan.`);
		}

		if (plan.actions.length === 0) {
			return Refuse('Nothing To Restore', 'The server already matches this snapshot for the scope you picked.');
		}

		const channel = interaction.channel;
		if (!channel?.isSendable()) {
			return Refuse('Cannot Post Here', 'I need to be able to send messages in this channel to post the restore log. Start the restore somewhere I can talk.');
		}

		// Permissions can change between preview and confirm. `Options.ts` checks this at the entry
		// screen, but nothing re-checks it here - without this, the safety snapshot and run row get
		// written before every action fails downstream.
		const botMember = guild.members.me;
		const missing = ([
			[ DiscordPermissions.ManageChannels, 'Manage Channels' ],
			[ DiscordPermissions.ManageRoles   , 'Manage Roles'    ],
			[ DiscordPermissions.BanMembers    , 'Ban Members'     ],
		] as const).filter(([ permission ]) => !botMember?.permissions.has(permission));

		if (missing.length > 0) {
			return Refuse('Missing Permissions', `I need \`Manage Channels\`, \`Manage Roles\`, and \`Ban Members\` to restore this server.\n\n**Missing:** ${missing.map(([ , name ]) => `\`${name}\``).join(', ')}`);
		}

		// Claimed before the first await below so two confirmations landing together cannot both
		// pass the check above
		if (!ClaimRestoreLock(guild.id)) {
			return Refuse('Restore In Progress', 'This server is already being restored. Wait for that run to finish before starting another.');
		}

		let restoreID: number | null = null;
		try {
			// A restore is irreversible without this, so failing to take it is fatal - unlike
			// failing to pin it, which only risks it being rotated away later
			let safetySnapshotID: number;
			try {
				safetySnapshotID = await CreateSnapshot(guild, SNAPSHOT_TYPE.MANUAL);
			} catch (error) {
				Log('ERROR', error);
				ReleaseRestoreLock(guild.id);
				return Refuse('Safety Snapshot Failed', 'I could not snapshot the server as it is right now, which would leave you no way back. Nothing has been changed.');
			}

			const pinned = await SetSnapshotPinStatus(safetySnapshotID, true).then(() => true).catch(() => false);

			restoreID = await CreateRestoreRun({
				guild_id          : BigInt(guild.id),
				snapshot_id       : typeof snapshotData.id === 'number' ? snapshotData.id : null,
				import_id         : typeof snapshotData.id === 'string' ? snapshotData.id : null,
				safety_snapshot_id: safetySnapshotID,
				user_id           : BigInt(interaction.user.id),
				channel_id        : BigInt(channel.id),
				mask
			}, plan.actions);

			// Public on purpose: a restore is an audit event other admins should be able to see,
			// and the runner needs a message that outlives the interaction token
			const message = await channel.send({
				embeds: [{
					color: COLOR.PRIMARY,
					title: `${EMOJI.RESTORE} Restoring ${SnapshotLabel(snapshotData)}`,
					description: `${EMOJI.LOADING} Starting...`,
					footer: { text: `Started by ${interaction.user.tag} · 0 / ${plan.actions.length} actions · do not delete this message` }
				}]
			});

			await SetRestoreMessage(restoreID, BigInt(message.id));

			// Fire and forget - a restore runs for minutes and cannot be awaited inside an interaction handler
			void RunRestore(restoreID, guild.id).catch(Log.bind(null, 'ERROR'));

			return {
				embeds: [{
					color: COLOR.SUCCESS,
					title: 'Restore Started',
					description: `
Applying **${plan.actions.length}** action${plan.actions.length === 1 ? '' : 's'} to this server. Progress is posted in ${channel}.

${EMOJI.SNAPSHOT} Snapshot #${safetySnapshotID} holds what the server looked like before this ran${pinned ? '' : `, but I could not pin it - your snapshot slots are full, so it may be rotated away`}.`
				}],
				components: [{
					type: 1,
					components: [{
						type: 2,
						style: 5,
						label: 'Open restore log',
						url: message.url,
						emoji: { name: EMOJI.SEARCH }
					}]
				}]
			}
		} catch (error) {
			// The run row may already exist - close it out rather than leaving it RUNNING forever
			if (restoreID !== null) await FinishRestoreRun(restoreID, RESTORE_STATUS.FAILED, 0).catch(Log.bind(null, 'ERROR'));
			ReleaseRestoreLock(guild.id);
			throw error;
		}
	}
} satisfies ModalHandler as ModalHandler;