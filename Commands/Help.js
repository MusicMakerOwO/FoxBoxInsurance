const { SlashCommandBuilder } = require('@discordjs/builders');
const { COLOR } = require('../Utils/Constants');


const RootCache = new Map(); // alias name -> command name
function ResolveRootCommand(client, commandName) {
	if (RootCache.has(commandName)) return RootCache.get(commandName);

	// { name: 'command', aliases: ['alias1', 'alias2', ...], ... }
	const commandData = client.commands.get(commandName);
	if (!commandData) return null;

	const root = commandData.base_command ?? commandData.data.name;
	if (commandData.aliases) {
		for (const alias of commandData.aliases) {
			RootCache.set(alias, root);
		}
	}

	RootCache.set(commandName, root);
	return root;
}

module.exports = {
	bypass: true,
	usage: '/help <command>',
	examples: [
		'/help',
		'/help download',
		'/help stats'
	],
	data: new SlashCommandBuilder()
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
			await interaction.respond(commandList.map(x => ({ name: '/' + x, value: x })));
			return;
		}

		if (focusedValue.startsWith('/')) {
			focusedValue = focusedValue.slice(1);
		}

		const filtered = commandList.filter(x => x.includes(focusedValue));
		await interaction.respond(
			filtered.map(x => ({ name: '/' + x, value: x }))
		);
		return;
	},
	execute: async function (interaction, client) {
		const commandName = interaction.options.getString('command');
		const rootName = ResolveRootCommand(client, commandName);

		if (rootName) {
			const commandData = client.commands.get(rootName);
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

			await interaction.reply({
				embeds: [embed],
				ephemeral: true,
			});

			return;
		}

		const dropdown = {
			type: 1,
			components: [{
				type: 3,
				custom_id: 'command-help',
				placeholder: 'Select a command',
				options: [],
			}],
		}

		const lines = [];
		lines.push('```');
		lines.push('/help\n');
		lines.push('Available commands:');
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

		const embed = {
			color: COLOR.PRIMARY,
			description: lines.join('\n'),
		};
		await interaction.reply({
			embeds: [embed],
			components: [dropdown],
			ephemeral: true,
		});
	}
}