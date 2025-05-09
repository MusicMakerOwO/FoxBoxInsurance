const { SlashCommandBuilder } = require('@discordjs/builders');
const { COLOR } = require('../Utils/Constants');

const CHANGELOG = {
	"v2.0.1": {
		date: "2025 May 3rd",
		changes: [
			"This command lol",
			"Minor bug fixes",
			"Edge case for default avatars",
			"Made some commands publically visible"
		]
	},
	"v2.0.2": {
		date: "2025 May 5th",
		changes: [
			"Better time handling for automated tasks"
		]
	},
	"v2.1.0": {
		date: "2025 May 7th",
		changes: [
			"Better handling for failed messages",
			"Put the wrong link below lmao"
		]
	},
	"v2.1.1": {
		date: "2025 May 8th",
		changes: [
			"Database optimizations :>"
		]
	},
	"v2.2.0": {
		date: "2025 May 8th",
		changes: [
			"Rebuilt the changelog command to show past versions"
		]
	},
	"v2.2.1": {
		date: "2025 May 8th",
		changes: [
			"Fixed time collissions for automated tasks",
			"Updated changelog versions to be more consistent",
			"Fixed typo in previous changelog"
		]
	},
	"v2.3.0": {
		date: "2025 May 9th",
		changes: [
			"Added database backups",
			"Added logs for internal analytics ( [Privacy Policy](https://www.notfbi.dev/privacy#retention) )",
			"Updated access requirements for some commands",
		]
	}
}

const OLDEST_VERSION = Object.keys(CHANGELOG).sort((a, b) => a.localeCompare(b))[0];
const LATEST_VERSION = Object.keys(CHANGELOG).sort((a, b) => b.localeCompare(a))[0];

module.exports = {
	bypass: true,
	data: new SlashCommandBuilder()
		.setName('changelog')
		.setDescription('New here? Check out what has changed!')
		.addStringOption(x => x
			.setName('version')
			.setDescription('The version you want to check')
			.setRequired(false)
			.addChoices([
				{ name: 'Latest', value: 'latest' },
				{ name: 'All', value: 'historical' },
				... Object.entries(CHANGELOG).sort((a, b) => b[0].localeCompare(a[0])).map(([version, data]) => ({ name: version, value: version })),
			])
		),
	execute: async function(interaction, client) {
		const input = interaction.options.getString('version') || 'latest';
		
		if (input === 'historical') {
			// show all versions
			const embed = {
				color: COLOR.PRIMARY,
				title: `Fox Box Insurance : Historical Changelogs`,
				description: ''
			}

			for (const [version, data] of Object.entries(CHANGELOG).sort((a, b) => b[0].localeCompare(a[0]))) {
				embed.description += `**${version}** - \`${data.date}\`\n`;
				embed.description += `${data.changes.map(x => `\\- ${x}`).join('\n')}\n\n`;
			}

			await interaction.reply({
				embeds: [embed]
			}).catch(() => {});
			return;
		}
			
		const version = input === 'latest' ? LATEST_VERSION : input;

		const data = CHANGELOG[version];
		if (!data) {
			console.error(`Changelog for version "${input}" not found`);
			await interaction.reply({
				content: `No changelog found for version \`${input}\``,
				ephemeral: true
			}).catch(() => {});
			return;
		}

		const embed = {
			color: COLOR.PRIMARY,
			title: `Fox Box Insurance : ${version}`,
			description: `
Updated: \`${data.date}\`

${data.changes.map(x => `\\- ${x}`).join('\n')}

https://github.com/MusicMakerOwO/FoxBoxInsurance/commits/main`
		};

		await interaction.reply({
			embeds: [embed]
		}).catch(() => {});
	}
}