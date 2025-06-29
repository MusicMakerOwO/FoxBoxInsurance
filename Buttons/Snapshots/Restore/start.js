const { COLOR, EMOJI, SNAPSHOT_TYPE, SECONDS } = require("../../../Utils/Constants");
const Database = require("../../../Utils/Database");
const { CreateJob, GetJob, STATUS, isGuildRestoring, API_TYPES, isRateLimited } = require("../../../Utils/Parsers/RestoreJobs");
const Permissions = require("../../../Utils/Permissions");
const ProgressBar = require("../../../Utils/ProgressBar");
const { UpdateHashes, ClearCache, CreateSnapshot, ALLOWED_CHANNEL_TYPES } = require("../../../Utils/SnapshotUtils");

const RolePositionError = {
	color: COLOR.ERROR,
	title: 'Missing Permissions',
	description: `
Please ensure that FBI's role is at the top of the role list!
1) Click on the server name at the top left of Discord
2) Find where it says "Server Settings", then click on "Roles"
3) Find the role "Fox Box Insurance" and drag that to the VERY top of the list`
}

const BotPermissionsError = {
	color: COLOR.ERROR,
	title: 'Missing Permissions',
	description: `
Please ensure that FBI is a server admin!
1) Click on the server name at the top left of Discord
2) Find where it says "Server Settings", then click on "Roles"
3) Find the role "Fox Box Insurance" and click on it
4) Click on the "Permissions" tab at the top
5) Scroll down to the very bottom of the list and enable "Administrator"`
}

const EnableCommunityEmbed = {
	color: COLOR.ERROR,
	title: 'Enable Community',
	description: `
Some of the channels in this snapshot require the server to be a "community" server.
In Discord terms, this allows for things like threads, announcements, and forums.
1) Click on the server name at the top left of Discord
2) Find where it says "Server Settings"
3) On the left sidebar, scroll to the bottom and find "Enable Community"
4) Click "Get Started" in the middle of the screen
5) Follow the prompts to enable community features`
}


const MissingMemberError = {
	color: COLOR.ERROR,
	description: 'Something went wrong ... \nPlease try again later or contact support 💔'
}

const CheckingPermsEmbed = {
	color: COLOR.PRIMARY,
	title: 'Checking Permissions',
	description: `${EMOJI.LOADING} Please wait while I check my permissions in this server...`
}

const RestoreExpiredEmbed = {
	color: COLOR.ERROR,
	title: 'Restore Expired',
	description: 'This menu has expired, please run the command'
}

const LoadingEmbed = {
	color: COLOR.PRIMARY,
	description: `${EMOJI.LOADING} Loading ...`
}

const AlreadyRunningEmbed = {
	color: COLOR.ERROR,
	title: 'Restore Already Running',
	description: 'A restore job is already running in this server. Please cancel or wait for it to complete before starting a new one.'
}

const CleaningUpEmbed = {
	color: COLOR.PRIMARY,
	title: 'Cleaning Up',
	description: `${EMOJI.LOADING} Cleaning up, one moment ...`
}

function ConvertTimeToText(seconds) {
	if (seconds < 1) return '0 seconds';

	const days = ~~(seconds / SECONDS.DAY);
	seconds %= SECONDS.DAY;
	const hours = ~~(seconds / SECONDS.HOUR);
	seconds %= SECONDS.HOUR;
	const minutes = ~~(seconds / SECONDS.MINUTE);
	seconds %= SECONDS.MINUTE;

	let output = '';
	if (days) output += `${days} day${days > 1 ? 's' : ''} `;
	if (hours) output += `${hours} hour${hours > 1 ? 's' : ''} `;
	if (minutes) output += `${minutes} minute${minutes > 1 ? 's' : ''} `;
	if (seconds) output += `${~~(seconds * 1000) / 1000} second${seconds > 1 ? 's' : ''}`;

	return output;
}

const PUBLIC_PERMS_ALLOW = Permissions.ViewChannel | Permissions.SendMessages;
const PUBLIC_PERMS_DENY = Permissions.CreatePublicThreads | Permissions.CreatePrivateThreads | Permissions.EmbedLinks | Permissions.AttachFiles;
const PRIVATE_PERMS_ALLOW = Permissions.ViewChannel | Permissions.SendMessages | Permissions.CreatePublicThreads | Permissions.CreatePrivateThreads | Permissions.EmbedLinks | Permissions.AttachFiles;

// only text and voice channels are public
const COMMUNITY_CHANNEL_TYPES = new Set(Array.from(ALLOWED_CHANNEL_TYPES).filter(x => x !== 0 && x !== 2)); // 0 = GUILD_TEXT, 2 = GUILD_VOICE

module.exports = {
	customID: 'restore-start',
	execute: async function(interaction, client, args) {

		await interaction.deferUpdate();

		const RestoreJob = client.ttlcache.get(`restore-job-${interaction.guild.id}`);
		if (!RestoreJob) {
			return interaction.editReply({
				embeds: [RestoreExpiredEmbed],
				components: []
			});
		}

		if (isGuildRestoring(interaction.guild.id)) {
			return interaction.editReply({
				embeds: [AlreadyRunningEmbed],
				components: []
			});
		}

		await interaction.editReply({
			embeds: [CheckingPermsEmbed],
			components: []
		});

		await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate some delay for checking permissions, purely cosmetic lol

		const snapshotID = parseInt( args[0] );
		if (isNaN(snapshotID) || snapshotID < 1) {
			throw new Error(`Invalid snapshot ID provided : ${args[0]}`);
		}

		const retryButton = {
			type: 1,
			components: [{
				type: 2,
				style: 2,
				label: 'Retry',
				custom_id: `restore-start_${args.join('_')}`,
				emoji: '🔄'
			}]
		}

		const botMember = interaction.guild.members.cache.get(client.user.id) ?? await interaction.guild.members.fetch(client.user.id).catch(() => null);
		if (!botMember) {
			return interaction.editReply({
				embeds: [MissingMemberError],
				components: [retryButton]
			});
		}

		if (!botMember.permissions.has('Administrator')) {
			return interaction.editReply({
				embeds: [BotPermissionsError],
				components: [retryButton]
			});
		}
		const botRole = interaction.guild.roles.cache.find(role => role.tags?.botId === client.user.id);
		if (botRole.position < interaction.guild.roles.highest.position) {
			return interaction.editReply({
				embeds: [RolePositionError],
				components: [retryButton]
			});
		}

		const requiresCommunity = RestoreJob.actions.some(action => action.type === API_TYPES.CHANNEL_CREATE && COMMUNITY_CHANNEL_TYPES.has(action.data.type));
		if (requiresCommunity && !interaction.guild.features.includes('COMMUNITY')) {
			return interaction.editReply({
				embeds: [EnableCommunityEmbed],
				components: [retryButton]
			});
		}

		// create a channel at the top of the channel list for updates
		const updateChannel = await interaction.guild.channels.create({
			name: 'restore-updates',
			type: 0, // GUILD_TEXT
			permissionOverwrites: [
				{
					id: interaction.guild.id,
					allow: PUBLIC_PERMS_ALLOW,
					deny: PUBLIC_PERMS_DENY,
					type: 0 // Role
				},
				{
					id: client.user.id,
					allow: PRIVATE_PERMS_ALLOW,
					deny: 0n, // No denies for the bot
					type: 1 // Member
				}
			],
			position: 0,
			parent: null
		});

		const updateMessage = await updateChannel.send({
			content: `<@${interaction.user.id}>`,
			embeds: [ LoadingEmbed ],
			components: []
		});

		interaction.editReply({
			embeds: [{
				color: COLOR.PRIMARY,
				title: 'Restore Started',
				description: `You will receive updates in <#${updateChannel.id}>`
			}],
			components: [{
				type: 1,
				components: [{
					type: 2,
					style: 5, // Link button
					url: `https://discord.com/channels/${interaction.guild.id}/${updateChannel.id}`,
					label: 'View Updates',
					emoji: '📢'
				}]
			}]
		});

		const jobID = CreateJob(RestoreJob);

		updateMessage.edit({
			content: `<@${interaction.user.id}>`,
			embeds: [{
				color: COLOR.PRIMARY,
				description: `
${EMOJI.LOADING} Working on it ... \`\`\`
Progress : ${ProgressBar(0)}
Status : ${STATUS.RUNNING}
\`\`\``
			}],
			components: [{
				type: 1,
				components: [{
					type: 2,
					style: 2, // Secondary button
					label: 'Cancel',
					custom_id: `restore-cancel_${jobID}`,
					emoji: '❌'
				}]
			}]
		});

		let prevProgress = 0;
		let restoreETA = 'Calculating...';

		const interval = setInterval( async () => {

			if (isRateLimited()) return;

			const job = GetJob(jobID);
			if (!job) {
				clearInterval(interval);
				throw new Error(`Job #${jobID} not found in cache - Was it deleted by accident?`);
			}

			if (job.status === STATUS.RUNNING) {
				const progress = job.progress; // getter

				const deltaProgress = progress - prevProgress; // how much has changed since last update
				prevProgress = progress + 0; // de-reference to avoid pointer issues

				if (deltaProgress > 0) {
					const remaining = 1 - progress; // assuming progress is between 0 and 1
					restoreETA = Math.ceil(remaining / deltaProgress); // in seconds
				}

				const bar = ProgressBar(job.progress);

				updateMessage.edit({
					content:'',
					embeds: [{
						color: COLOR.PRIMARY,
						description: `
${EMOJI.LOADING} Working on it ... \`\`\`
Progress : ${bar}
Status : ${job.status.toUpperCase()}
\`\`\`
ETA to complete : \`${typeof restoreETA === 'number' ? ConvertTimeToText(restoreETA) : restoreETA}\`
Step ${job.cursor + 1} / ${job.actions.length + 1}`
					}]
				});
				return;
			}

			clearInterval(interval);

			if (job.status === STATUS.COMPLETED) {
				updateMessage.edit({
					content: '',
					embeds: [ CleaningUpEmbed ],
					components: []
				});

				if (job.snapshot_type !== SNAPSHOT_TYPE.IMPORT) {
					// update the ids in the snapshots
					for (const [oldID, newID] of job.channel_lookups) {
						// Snapshot data
						Database.prepare(`
							UPDATE SnapshotChannels
							SET id = ?, needsUpdate = 1
							WHERE snapshot_id = ?
							AND id = ?
						`).run(newID, snapshotID, oldID);

						// Channel parents
						Database.prepare(`
							UPDATE SnapshotChannels
							SET parent_id = ?, needsUpdate = 1
							WHERE snapshot_id = ?
							AND parent_id = ?
						`).run(newID, snapshotID, oldID);

						// Permission overwrites
						Database.prepare(`
							UPDATE SnapshotPermissions
							SET channel_id = ?, needsUpdate = 1
							WHERE channel_id = ?
						`).run(newID, oldID);

						// Messages data - No hashing here!
						Database.prepare(`
							UPDATE Messages
							SET channel_id = ?
							WHERE channel_id = ?
						`).run(newID, oldID);
					}

					for (const [oldID, newID] of job.role_lookups) {
						// Snapshot data
						Database.prepare(`
							UPDATE SnapshotRoles
							SET id = ?, needsUpdate = 1
							WHERE snapshot_id = ?
							AND id = ?
						`).run(newID, snapshotID, oldID);

						// Permissions data
						Database.prepare(`
							UPDATE SnapshotPermissions
							SET role_id = ?, needsUpdate = 1
							WHERE role_id = ?
						`).run(newID, oldID);
					}

					await UpdateHashes(snapshotID);
				} else {
					await CreateSnapshot(interaction.guild, SNAPSHOT_TYPE.AUTOMATIC);
				}

				await new Promise(resolve => setTimeout(resolve, 1000));

				const embed = {
					color: COLOR.SUCCESS,
					title: 'Restore Completed',
					description: 'The restore job has completed successfully!'
				}

				if (job.errors.length > 0) {
					embed.description += `\n\n${EMOJI.WARNING} Some errors occurred during the restoration :`
					let i = 0;
					while (embed.description.length < 2000) {
						if (i >= job.errors.length) break; // no more errors to add
						embed.description += ` \`\`\`${job.errors[i]}\`\`\``;
						i++;
					}
					if (i < job.errors.length) {
						embed.description += `\n\n> **And ${job.errors.length - i} more errors not shown**`;
					}
				}

				updateMessage.edit({
					content: '',
					embeds: [ embed ],
					components: []
				});

				ClearCache(snapshotID);

				return;
			}

			if (job.status === STATUS.FAILED) {
				updateMessage.edit({
					content: '',
					embeds: [{
						color: COLOR.ERROR,
						title: 'Restore Failed',
						description: `
The restore job has failed with the following errors:
\`\`\`
${job.errors.join('\n')}
\`\`\` Please try again later or contact support 💔`
					}],
					components: []
				});
				return;
			}
		}, 1000);

	}
}