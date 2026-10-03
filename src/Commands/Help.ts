import {CommandHandler} from "../Typings/HandlerTypes.js";
import {SlashCommandBuilder} from "discord.js";
import {COLOR} from "../Utils/Constants.js";
import {DiscordActionRow, DiscordStringSelect} from "../Typings/DiscordTypes.js";
import {IClient} from "../Client.js";

/** Every command once, without its aliases, sorted by name */
function RootCommands(client: IClient): CommandHandler[] {
	return Array.from(new Set(client.commands.values())).sort((a, b) => a.data.name.localeCompare(b.data.name));
}

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'reply',
	hidden        : false,
	usage         : '/help <command>',
	examples      : [
		'/help',
		'/help download',
		'/help stats'
	],
	data          : new SlashCommandBuilder()
		.setName('help')
		.setDescription('Get help with commands')
		.addStringOption(x => x
			.setName('command')
			.setDescription('The command you need help with')
			.setRequired(false)
			.setAutocomplete(true)
		),
	autocomplete: async function (interaction, client) {
		let focusedValue = interaction.options.getFocused();
		if (!focusedValue) {
			return RootCommands(client).map(x => ({ name: '/' + x.data.name, value: x.data.name }));
		}

		if (focusedValue.startsWith('/')) {
			focusedValue = focusedValue.slice(1);
		}

		// Aliases can be searched for too. Discord rejects more than 25 choices
		const commandList = Array.from(client.commands.keys()).sort((a, b) => a.localeCompare(b));
		const filtered = commandList.filter(x => x.includes(focusedValue)).slice(0, 25);
		return filtered.map(x => ({ name: '/' + x, value: x }))
	},
	execute: async function (interaction, client) {
		const commandName = interaction.options.getString('command');
		// `null` is a valid lookup in JS but will return `undefined`, so hence all the assertions and nullish checks o_O
		const rootName = client.commands.get(commandName!)?.data.name ?? null;

		if (rootName) {
			const commandData = client.commands.get(rootName)!;
			const lines = [];

			lines.push(`/${commandData.data.name}`);
			lines.push(`\n${commandData.data.description}`);

			if (commandData.usage) {
				lines.push(`\nUsage: ${commandData.usage}`);
			}

			if (commandData.examples) {
				lines.push('\nExamples:');
				for (const example of commandData.examples) {
					lines.push(`  ${example}`);
				}
			}

			if (commandData.aliases && commandData.aliases.length > 0) {
				lines.push('\nAliases:');
				for (const alias of commandData.aliases) {
					lines.push(`  /${alias}`);
				}
			}

			const embed = {
				color: COLOR.PRIMARY,
				description: '```\n' + lines.join('\n') + '\n```',
			};

			return {
				embeds: [embed]
			}
		}

		const dropdown: DiscordActionRow<DiscordStringSelect> = {
			type: 1,
			components: [{
				type: 3,
				custom_id: 'command-help',
				options: [],
			}],
		}

		// Aliases share their command's entry - listed separately they pushed the dropdown past Discord's 25 options
		const rootCommands = RootCommands(client);

		const lines = [];
		lines.push('```');
		lines.push(`Available commands (${rootCommands.length} total)`);
		for (const command of rootCommands) {
			const aliases = command.aliases?.length ? ` (${command.aliases.join(', ')})` : '';
			lines.push(`  /${command.data.name}${aliases}`);
			dropdown.components[0].options.push({
				label: '/' + command.data.name,
				value: command.data.name
			});
		}
		lines.push('\nUse `/help <command>` for more information on a specific command.');
		lines.push('```');
		return {
			embeds: [{
				color: COLOR.PRIMARY,
				description: lines.join('\n'),
			}],
			components: [dropdown]
		}
	}
} satisfies CommandHandler as CommandHandler;