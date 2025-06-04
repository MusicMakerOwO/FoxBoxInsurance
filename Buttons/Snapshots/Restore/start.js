const { COLOR, EMOJI } = require("../../../Utils/Constants");
const Permissions = require("../../../Utils/Permissions");

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

const PUBLIC_PERMS_ALLOW = Permissions.ViewChannel | Permissions.SendMessages;
const PUBLIC_PERMS_DENY = Permissions.CreatePublicThreads | Permissions.CreatePrivateThreads | Permissions.EmbedLinks | Permissions.AttachFiles;
const PRIVATE_PERMS_ALLOW = Permissions.ViewChannel | Permissions.SendMessages | Permissions.CreatePublicThreads | Permissions.CreatePrivateThreads | Permissions.EmbedLinks | Permissions.AttachFiles;


module.exports = {
	customID: 'restore-start',
	execute: async function(interaction, client, args) {
		
		await interaction.deferUpdate();

		const RestoreJob = client.timedCache.get(`restore-job-${interaction.guild.id}`);
		if (!RestoreJob) {
			return interaction.editReply({
				embeds: [RestoreExpiredEmbed],
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
		const botRole = interaction.guild.roles.cache.find(role => role.tags.botId === client.user.id);
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

		// Create the restore job
		console.log(RestoreJob);
	}
}