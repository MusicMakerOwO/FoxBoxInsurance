import {CommandHandler} from "../Typings/HandlerTypes";
import {SlashCommandBuilder} from "discord.js";
import {COLOR} from "../Utils/Constants";
import {DiscordActionRow, DiscordStringSelect} from "../Typings/DiscordTypes";

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
		const commandList = Array.from(client.commands.keys()).sort((a, b) => a.localeCompare(b));

		let focusedValue = interaction.options.getFocused();
		if (!focusedValue) {
			return commandList.map(x => ({ name: '/' + x, value: x }));
		}

		if (focusedValue.startsWith('/')) {
			focusedValue = focusedValue.slice(1);
		}

		const filtered = commandList.filter(x => x.includes(focusedValue));
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
				embeds: [embed],
				ephemeral: true,
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

		const lines = [];
		lines.push('```');
		lines.push(`Available commands (${client.commands.size} total)`);
		const commandList = Array.from(client.commands.keys()).sort((a, b) => a.localeCompare(b));
		for (const commandName of commandList) {
			lines.push(`  /${commandName}`);
			dropdown.components[0].options.push({
				label: '/' + commandName,
				value: commandName
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