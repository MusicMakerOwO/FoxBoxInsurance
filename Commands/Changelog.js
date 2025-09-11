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
	},
	"v2.4.0": {
		date: "2025 May 11th",
		changes: [
			"Added a prompt to accept the TOS after inviting",
			"Bug that bot tries to read DMs (it can't lol)",
		]
	},
	"v2.4.1": {
		date: "2025 May 13th",
		changes: [
			"Small bug fixes"
		]
	},
	"v2.4.2": {
		date: "2025 May 18th",
		changes: [
			"Adjusted internal logs to be more readable",
			"Small database optimizations",
		]
	},
	"v2.4.3": {
		date: "2025 May 26th",
		changes: [
			"Adjusted internal configs for (slightly) better performance"
		]
	},
	"v2.4.4": {
		date: "2025 June 28th",
		changes: [
			"Couple of small fixes to message exporting",
			"Error message if no messages found in channel",
			"Popup message if server has not accepted the TOS"
		]
	},
	"v2.4.5": {
		date: "2025 June 29th",
		changes: [
			"Fixed a bug with stale data in cache"
		]
	},
	"v2.4.6": {
		date: "2025 July 1st",
		changes: [
			"Little changes for (slightly) better performance",
			"Fixed a bug where accepting the TOS would have no effect"
		]
	},
	"v2.4.7": {
		date: "2025 July 5th",
		changes: [
			"Security patch that exposes encryption tags in JSON exports"
		]
	},
	"v3.0.0": {
		date: "2025 July 8th",
		changes: [
			"Huge update to the bot, lots of stuff changed lol",
			"Added snapshots for full server backups - See /snapshot",
			"Backup roles, channels, permissions, and bans with one click",
			"Snapshots can be exported and shared around, allowing server cloning",
			"Messages are not restored (coming soon)",
			"Messages will never be exported in snapshots"
		]
	},
	"v3.0.1": {
		date: "2025 July 11th",
		changes: [
			"Bunch of little bug fixes",
			"Latest version now shows in /info command",
			"Minor touches to internal logs, nothing to note"
		]
	},
	"v3.0.2": {
		date: "2025 July 22th",
		changes: [
			"Fixed a bug where TOS could not be accepted from DMs (credit to @titsou.js)",
			"Fixed a display issue allowing you to accept the TOS twice (credit to @titsou.js)",
		]
	},
	"v3.0.3": {
		date: "2025 August 1st",
		changes: [
			"Updated server costs in /donate with the addition of email hosting"
		]
	},
	"v4.0.0": {
		date: "2025 September 11th",
		changes: [
			"Switched databases",
			"Minor bug fixes and performance improvements",
			"New and stronger encryption for messages"
		]
	},
	"v4.0.1": {
		date: "2025 September 11th",
		changes: [
			"Better error message for deleting a pinned snapshot"
		]
	}
}

const OLDEST_VERSION = Object.keys(CHANGELOG).sort((a, b) => a.localeCompare(b))[0];
const LATEST_VERSION = Object.keys(CHANGELOG).sort((a, b) => b.localeCompare(a))[0];

module.exports = {
	LATEST_VERSION,
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
				{ name: 'All', value: 'all' },
				... Object.entries(CHANGELOG).sort((a, b) => b[0].localeCompare(a[0])).map(([version, data]) => ({ name: version, value: version })),
			])
		),
	execute: async function(interaction, client) {
		const input = interaction.options.getString('version') || 'latest';

		if (input === 'all') {
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

			return interaction.reply({
				embeds: [embed]
			});
		}

		const version = input === 'latest' ? LATEST_VERSION : input;

		const data = CHANGELOG[version];
		if (!data) {
			console.error(`Changelog for version "${input}" not found`);
			return interaction.reply({
				content: `No changelog found for version \`${input}\``,
				ephemeral: true
			});
		}

		const embed = {
			color: COLOR.PRIMARY,
			title: `Fox Box Insurance : ${version}`,
			description: `
Updated: \`${data.date}\`

${data.changes.map(x => `\\- ${x}`).join('\n')}

https://github.com/MusicMakerOwO/FoxBoxInsurance/commits/main`
		};

		return interaction.reply({
			embeds: [embed]
		});
	}
}