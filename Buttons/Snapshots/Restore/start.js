const { COLOR, EMOJI } = require("../../../Utils/Constants");
const Database = require("../../../Utils/Database");
const { CreateJob, GetJob, STATUS, isGuildRestoring } = require("../../../Utils/Parsers/RestoreJobs");
const Permissions = require("../../../Utils/Permissions");
const ProgressBar = require("../../../Utils/ProgressBar");
const { UpdateHashes, ClearCache } = require("../../../Utils/SnapshotUtils");

const RolePositionError = {
	color: COLOR.ERROR,
	title: 'Missing Permissions',
	description: `
Please ensure that FBI's role is at the top of the role list!
1) Click on the server name at the top left of Discord
2) Find where it says "Server Settings", then click on "Roles".
3) Find the role "Fox Box Insurance" and drag that to the VERY top of the list.`
}

const BotPermissionsError = {
	color: COLOR.ERROR,
	title: 'Missing Permissions',
	description: `
Please ensure that FBI is a server admin!
1) Click on the server name at the top left of Discord
2) Find where it says "Server Settings", then click on "Roles".
3) Find the role "Fox Box Insurance" and click on it.
4) Click on the "Permissions" tab at the top
5) Scroll down to the very bottom of the list and enable "Administrator".`
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

const RestoreCompletedEmbed = {
	color: COLOR.SUCCESS,
	title: 'Restore Completed',
	description: 'The restore job has completed successfully!'
}

const RestoreAbortedEmbed = {
	color: COLOR.ERROR,
	title: 'Restore Aborted',
	description: 'The restore job was aborted by the owner.'
}

const AlreadyRunningEmbed = {
	color: COLOR.ERROR,
	title: 'Restore Already Running',
	description: 'A restore job is already running in this server. Please cancel or wait for it to complete before starting a new one.'
}

const PUBLIC_PERMS_ALLOW = Permissions.ViewChannel | Permissions.SendMessages;
const PUBLIC_PERMS_DENY = Permissions.CreatePublicThreads | Permissions.CreatePrivateThreads | Permissions.EmbedLinks | Permissions.AttachFiles;
const PRIVATE_PERMS_ALLOW = Permissions.ViewChannel | Permissions.SendMessages | Permissions.CreatePublicThreads | Permissions.CreatePrivateThreads | Permissions.EmbedLinks | Permissions.AttachFiles;


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

		const interval = setInterval( async () => {
			const job = GetJob(jobID);

			if (job.status === STATUS.RUNNING) {
				const bar = ProgressBar(job.progress);

				updateMessage.edit({
					content:'',
					embeds: [{
						color: COLOR.PRIMARY,
						description: `
	${EMOJI.LOADING} Working on it ... \`\`\`
	Progress : ${bar}
	Status : ${job.status}
	\`\`\``
					}]
				});
				return;
			}

			clearInterval(interval);

			if (job.status === STATUS.COMPLETED) {
				updateMessage.edit({
					content: '',
					embeds: [ RestoreCompletedEmbed ],
					components: []
				});

				// update the ids in the snapshots
				for (const [oldID, newID] of job.channel_lookups) {
					Database.prepare(`
						UPDATE SnapshotChannels
						SET id = ?, needsUpdate = 1
						WHERE snapshot_id = ?
						AND id = ?
					`).run(newID, snapshotID, oldID);
				}

				UpdateHashes(snapshotID);

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

			if (job.status === STATUS.ABORTED) {
				updateMessage.edit({
					content: '',
					embeds: [ RestoreAbortedEmbed ],
					components: []
				});
				return;
			}
		}, 1000);

	}
}