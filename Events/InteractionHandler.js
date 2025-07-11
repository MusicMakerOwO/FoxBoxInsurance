const CheckCooldown = require('../Utils/Checks/Cooldown');
const GuildOwner = require('../Utils/Checks/GuildOwner');
const IDAccess = require('../Utils/Checks/IDAccess');
const RoleAccess = require('../Utils/Checks/RoleAccess');
const Permission = require('../Utils/Checks/Permissions');

const ErrorParse = require('../Utils/FindError');

const { FANCY_ERRORS } = require('../config.json');
const { COLOR } = require('../Utils/Constants');
const Database = require('../Utils/Database');
const { GetGuildTOS, GetUserTOS } = require('../Utils/Caching/TOS');

module.exports = {
	name: 'interactionCreate',
	execute: async function (client, interaction) {
		switch (interaction.type) {
			case 4: // Autocomplete
			case 2: // Slash Commands + Context Menus
				if (interaction.commandType === 1) {
					const subcommand = interaction.options._subcommand || "";
					const subcommandGroup = interaction.options._subcommandGroup || "";
					const commandArgs = interaction.options._hoistedOptions || [];
					const args = `${subcommandGroup} ${subcommand} ${commandArgs.map(arg => arg.value).join(" ")}`.trim();
					client.logs.info(`${interaction.user.tag} (${interaction.user.id}) > /${interaction.commandName} ${args}`);
					InteractionHandler(client, interaction, 'commands', client.commands);
				} else {
					client.logs.info(`${interaction.user.tag} (${interaction.user.id}) > :${interaction.commandName}:`);
					InteractionHandler(client, interaction, 'context', client.context);
				}
				break;
			case 3: // Message Components
				if (interaction.isButton()) {
					client.logs.info(`${interaction.user.tag} (${interaction.user.id}) > [${interaction.customId}]`);
					InteractionHandler(client, interaction, 'buttons', client.buttons);
				} else if (interaction.isAnySelectMenu()) {
					client.logs.info(`${interaction.user.tag} (${interaction.user.id}) > <${interaction.customId} : ${interaction.values.join(', ')}>`);
					InteractionHandler(client, interaction, 'menus', client.menus);
				}
				break;
			case 5: // Modal submit
				client.logs.info(`${interaction.user.tag} (${interaction.user.id}) > {${interaction.customId}}`);
				InteractionHandler(client, interaction, 'modals', client.modals);
				break;
			default:
				client.logs.warn(`Unknown interaction type: ${interaction.type} - Unsure how to handle this...`);
				break;
		}
	}
}

const USER_TOS_Embed = {
	color: COLOR.PRIMARY,
	description: `
You are required to accept the Terms of Service before using this bot

By agreeing to the Terms you are agreeing to the following:
- You will not use this bot for illegal purposes
- You will not use the data for blackmail, harassment, doxxing, or any other malicious intent
- You will abide by the [Discord ToS](https://discord.com/terms) and [Community Guidelines](https://discord.com/guidelines)
- If you are caught violating these terms you will be banned from using this bot

You can find a fully copy of the terms here : https://www.notfbi.dev/terms`
}

const USER_TOS_BUTTONS = {
	type: 1,
	components: [
		{
			type: 2,
			style: 4,
			label: 'Decline',
			custom_id: 'close'
		},
		{
			type: 2,
			style: 3,
			label: 'Accept',
			custom_id: 'tos-accept'
		}
	]
}

const GUILD_TOS_Embed = {
	color: COLOR.PRIMARY,
	description: `
The server owner has not accepted the Terms of Service yet.
Please notify an admin to finish the setup process.`
}

const InsertUser = Database.prepare(`
	INSERT INTO Users (id, username, bot)
	VALUES (?, ?, ?)
	ON CONFLICT (id) DO NOTHING
`);

async function InteractionHandler(client, interaction, type, cache) {

	const args = interaction.customId?.split("_") ?? [];
	const name = args.shift() ?? interaction.commandName;

	Database.prepare(`
		INSERT INTO InteractionLogs (guild_id, channel_id, user_id, type, name)
		VALUES (?, ?, ?, ?, ?)
	`).run(
		interaction.guildId,
		interaction.channelId,
		interaction.user.id,
		type,
		name
	);

	const component = cache.get(name);
	if (!component) {
		interaction.reply({
			content: `There was an error while executing this command!\n\`\`\`Command not found\`\`\``,
			ephemeral: true
		});
		client.logs.error(`${type} not found: ${name}`);
		return;
	}

	if (component.allow_dm) {
		try {
			await component.execute(interaction, client, type === 'commands' ? undefined : args);
		} catch (error) {
			client.logs.error(error);
			await interaction.deferReply({ ephemeral: true }).catch(() => {});
			interaction.editReply({
				content: `There was an error while executing this command!\n\`\`\`${error}\`\`\``,
				embeds: [],
				components: [],
				files: []
			}).catch(() => {});
		}
		return;
	}

	interaction.deferUpdate ??= interaction.deferReply;

	// add the user to the database if they don't exist
	InsertUser.run(
		interaction.user.id,
		interaction.user.username,
		+interaction.user.bot
	);

	const guildAccepted = GetGuildTOS(interaction.guildId);
	const userAccepted = GetUserTOS(interaction.user.id);
	if (guildAccepted === 0 && component.bypass !== true) {
		if (interaction.user.id !== interaction.guild.ownerId) {
			// warn user that the server owner has not accepted TOS
			interaction.reply({ embeds: [GUILD_TOS_Embed], components: [], ephemeral: true });
		} else {
			// Owner must accept TOS
			interaction.reply({ embeds: [USER_TOS_Embed], components: [USER_TOS_BUTTONS], ephemeral: true });
		}
		return;
	}

	if (userAccepted === 0 && component.bypass !== true) {
		// Force users to accept TOS
		return interaction.reply({ embeds: [USER_TOS_Embed], components: [USER_TOS_BUTTONS], ephemeral: true });
	}


	if ('defer' in component && component.defer !== null) {
		await interaction.deferReply({ ephemeral: component.defer });
	}

	try {
		if (component.cooldown) CheckCooldown(client, interaction.user.id, name, component.cooldown);
		if (component.guilds) 	IDAccess(component.guilds, interaction.guildId, 'Guild');
		if (component.channels) IDAccess(component.channels, interaction.channelId, 'Channel');
		if (component.users) 	IDAccess(component.users, interaction.user.id, 'User');
		if (component.owner) 	GuildOwner(interaction.guild?.ownerId, interaction.user.id);
		if (component.roles) 	RoleAccess(component.roles, interaction.member);

		if (component.botPerms || component.userPerms) {
			if (!interaction.guild) throw ['This command cannot be used in DMs', 'DMs'];
			if (!interaction.user) throw ['This command cannot be used in DMs', 'DMs'];
			const botMember = interaction.guild 
				? interaction.guild.members.cache.get(client.user.id)
					?? await interaction.guild.members.fetch(client.user.id).catch(() => null) 
				: null;
			if (botMember !== null) {
				// This code will only trigger if
				// 1) Bot is in the guild (always will)
				// 2) Command not being run in DMs
				// 3) Client has GuildMembers intent
				// 4) Not actively rate limited
				Permission(client, component.botPerms, botMember); // bot
				Permission(client, component.userPerms, interaction.member); // user
			}
		}
	} catch (error) {
		await interaction.deferReply({ ephemeral: true }).catch(() => {});
		const payload = {
			content: '',
			embeds: [],
			components: [],
			files: [],
		}
		if (Array.isArray(error)) {
			const [response, reason] = error;
			payload.embeds = [{
				color: COLOR.ERROR,
				description: response,
			}];
			client.logs.error(`Blocked user from ${type}: ${reason}`);
		} else {
			// payload.content = `There was an error while executing this command!\n\`\`\`${error}\`\`\``;
			payload.embeds = [{
				color: COLOR.ERROR,
				description: `There was an error while executing this command!\n\`\`\`${error}\`\`\``,
			}];
			client.logs.error(error);
		}
		return interaction.editReply(payload);
	}

	try {
		if (interaction.isAutocomplete()) {
			if (typeof component.autocomplete !== 'function') throw 'Autocomplete function not implemented';
			await component.autocomplete(interaction, client, type === 'commands' ? undefined : args);
		} else {
			await component.execute(interaction, client, type === 'commands' ? undefined : args);
		}
	} catch (error) {
		client.logs.error(error);

		await interaction.deferReply({ ephemeral: true }).catch(() => {});

		if (!FANCY_ERRORS) {
			interaction.editReply({
				content: `There was an error while executing this command!\n\`\`\`${error}\`\`\``,
				embeds: [],
				components: [],
				files: [],
			}).catch(() => {});
		} else {
			const errorData = ErrorParse(error);
			if (errorData) {
				const embed = {
					color: 0xFF0000,
					description: `
	Command: \`${name}\`
	Error: \`${errorData.message}\`
	\`\`\`\n${errorData.lines.join('\n')}\`\`\``,
				}
				interaction.editReply({
					content: '',
					embeds: [embed],
					components: [],
					files: [],
				}).catch(() => {});
				return;
			}
		}
	}
}