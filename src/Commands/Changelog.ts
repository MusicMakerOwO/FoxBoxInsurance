import {SlashCommandBuilder} from "discord.js";
import {COLOR} from "../Utils/Constants";
import {CommandHandler} from "../Typings/HandlerTypes";

const CHANGELOG: Record<string, { date: string, changes: string[] }> = {
	"2.0.1": {
		date: "2025 May 3rd",
		changes: [
			"This command lol",
			"Minor bug fixes",
			"Edge case for default avatars",
			"Made some commands publicly visible"
		]
	},
	"2.0.2": {
		date: "2025 May 5th",
		changes: [
			"Better time handling for automated tasks"
		]
	},
	"2.1.0": {
		date: "2025 May 7th",
		changes: [
			"Better handling for failed messages",
			"Put the wrong link below lmao"
		]
	},
	"2.1.1": {
		date: "2025 May 8th",
		changes: [
			"Database optimizations :>"
		]
	},
	"2.2.0": {
		date: "2025 May 8th",
		changes: [
			"Rebuilt the changelog command to show past versions"
		]
	},
	"2.2.1": {
		date: "2025 May 8th",
		changes: [
			"Fixed time collisions for automated tasks",
			"Updated changelog versions to be more consistent",
			"Fixed typo in previous changelog"
		]
	},
	"2.3.0": {
		date: "2025 May 9th",
		changes: [
			"Added database backups",
			"Added logs for internal analytics ( [Privacy Policy](https://www.notfbi.dev/privacy#retention) )",
			"Updated access requirements for some commands",
		]
	},
	"2.4.0": {
		date: "2025 May 11th",
		changes: [
			"Added a prompt to accept the TOS after inviting",
			"Bug that bot tries to read DMs (it can't lol)",
		]
	},
	"2.4.1": {
		date: "2025 May 13th",
		changes: [
			"Small bug fixes"
		]
	},
	"2.4.2": {
		date: "2025 May 18th",
		changes: [
			"Adjusted internal logs to be more readable",
			"Small database optimizations",
		]
	},
	"2.4.3": {
		date: "2025 May 26th",
		changes: [
			"Adjusted internal configs for (slightly) better performance"
		]
	},
	"2.4.4": {
		date: "2025 June 28th",
		changes: [
			"Couple of small fixes to message exporting",
			"Error message if no messages found in channel",
			"Popup message if server has not accepted the TOS"
		]
	},
	"2.4.5": {
		date: "2025 June 29th",
		changes: [
			"Fixed a bug with stale data in cache"
		]
	},
	"2.4.6": {
		date: "2025 July 1st",
		changes: [
			"Little changes for (slightly) better performance",
			"Fixed a bug where accepting the TOS would have no effect"
		]
	},
	"2.4.7": {
		date: "2025 July 5th",
		changes: [
			"Security patch that exposes encryption tags in JSON exports"
		]
	},
	"3.0.0": {
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
	"3.0.1": {
		date: "2025 July 11th",
		changes: [
			"Bunch of little bug fixes",
			"Latest version now shows in /info command",
			"Minor touches to internal logs, nothing to note"
		]
	},
	"3.0.2": {
		date: "2025 July 22th",
		changes: [
			"Fixed a bug where TOS could not be accepted from DMs (credit to @titsou.js)",
			"Fixed a display issue allowing you to accept the TOS twice (credit to @titsou.js)",
		]
	},
	"3.0.3": {
		date: "2025 August 1st",
		changes: [
			"Updated server costs in /donate with the addition of email hosting"
		]
	},
	"4.0.0": {
		date: "2025 September 11th",
		changes: [
			"Switched databases",
			"Minor bug fixes and performance improvements",
			"New and stronger encryption for messages"
		]
	},
	"4.0.1": {
		date: "2025 September 11th",
		changes: [
			"Better error message for deleting a pinned snapshot (credit to @titsou.js)"
		]
	},
	"4.0.2": {
		date: "2025 September 18th",
		changes: [
			"Fixed a bug where restoring a snapshot would not update message data internally"
		]
	},
	"4.0.3": {
		date: "2025 October 1st",
		changes: [
			"Fixed website not loading properly (credit to @justabettergamingchair)",
			"Fixed error in /info (credit to @justabettergamingchair)",
			"Broken database query in /history (credit to @justabettergamingchair)",
			"Channel exports missing creation dates",
			"Bad data parsing when reading export metadata"
		]
	},
	"5.0.0": {
		date: "2026 April 12th",
		changes: [
			"Rebuilt the database for better storage and speeds",
			"Switched from JavaScript to TypeScript",
			"Rebuilt all internal components for better testing",
			"Rebuild message exports to be more efficient",
			"Added versioning for internal message encryption",
			"Reworked how user encryption keys are generated/stored",
			"Server owner is no longer required to accept TOS",
			"Added automatic internal testing",
			"Added TOS versioning",
			"Added toggleable server features",
			"Updated message deletion logic (10k messages/channel or 60 days, whichever comes first)",
			"Rebuilt how snapshots are created (better testing & easier to work with)",
			"Rebuilt how snapshots are imported",
			"Bumped snapshot export version for the new file format",
			"Changed the text in `/invite` to be less cheesy",
			"You can now decline a TOS update and continue using the bot as is",
			"Removed snapshot restoration to be added back in a later release",
			"Removed CSV format for exports because they make no sense and no one used them anyways",
			"Adjusted the export format selection to be easier to read",
			"All new HTML exports (credit to @banana.dev ❤️)",
		]
	},
	"5.0.1": {
		date: "2026 April 13th",
		changes: [
			"Update changelog to make it easier to find versions",
			"Fixed a bug that a failed automatic snapshot would abort the remaining servers",
			"Removed the \"all\" option from changelogs",
		]
	},
	"5.0.2": {
		date: "2026 April 14th",
		changes: [
			"Fixed global message stats to use the new database format",
			"Fixed snapshot list to appear in order of newest -> oldest",
			"Fixed page buttons on snapshot listing",
			"Updated the snapshot listing embed slightly to be more condensed"
		]
	},
	"5.0.3": {
		date: "2026 April 15th",
		changes: [
			"Fixed a rare bug that `UploadCDN()` would not emit an error",
			"Cleaned up some service code in regard to `/snapshot`",
			"Added an error if no bot role was found in the server (caused if you invite without permissions)",
			"Fixed a missing feature check when using `/snapshot`",
			"Snapshots where wrongly marked in queue for deletion",
		]
	},
	"5.0.4": {
		date: "2026 April 16th",
		changes: [
			"Fixed UploadStats() to push stats to website",
			"Fixed snapshot deletion button",
		]
	},
	"5.0.5": {
		date: "2026 April 24th",
		changes: [
			"Updated internal database management to better handle errors (credit to @sevryn.devyxi)",
			"Fixed an internal function confusing servers and channels (credit to @sevryn.devyxi)",
			"Fixed and issue prevent snapshots to be imported (credit to @banana.dev)",
			"Fixed an issue wrongly flagging snapshots as corrupted (credit to @banana.dev)",
			"Fixed a bug where the bot forgets about an import before confirmation (credit to @banana.dev)",
			"Fixed a badly formatted emoji on import confirmation",
			"Fixed a bug where imports would be pre-emptively saved to the server before clicking 'confirm'",
		]
	},
	"5.0.6": {
		date: "2026 April 26th",
		changes: [
			"Fixed a hash collision on message exports (credit to @banana.dev)",
			"Added feedback if you type a message count too large/small (credit to @banana.dev)",
		]
	},
	"5.0.7": {
		date: "2026 April 27th",
		changes: [
			"Fixed hash collisions on message exports (again)",
			"Updated `/verify` for easier future updates",
			"Fixed a memory leak causing the database to lock up"
		]
	}
} as const;

export const LATEST_VERSION = Object.keys(CHANGELOG).sort((a, b) => b.localeCompare(a))[0];

function ParseSemver(input: string): [major: string, minor: string, patch: string] {
	const parts = input.split('.');
	if (parts.length !== 3) throw new Error(`Invalid semver: ${input}`);
	return parts as ReturnType<typeof ParseSemver>;
}

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'reply',
	hidden        : false,
	data          : new SlashCommandBuilder()
	.setName('changelog')
	.setDescription('New here? Check out what has changed!')
	.addStringOption(x => x
		.setName('version')
		.setDescription('The version you want to check')
		.setRequired(false)
		.setAutocomplete(true)
	),
	autocomplete: async function(interaction) {
		let input = interaction.options.getFocused(false);
		if (input.startsWith('v')) input = input.replace(/^[A-Za-z]+/, '');

		if (!input) {
			const majors = Array.from( new Set(Object.keys(CHANGELOG).map(v => ParseSemver(v)[0] )) );
			return [
				{ name: 'Latest', value: 'latest' },
				... majors.map(major => ({ name: `v${major}`, value: `${major}.0.0` }))
			]
		} else {
			const versions = Object.keys(CHANGELOG).filter(v => v.startsWith(input) || v.startsWith(`v${input}`)).sort((a, b) => a.localeCompare(b)).slice(0, 25);
			return versions.map(v => ({ name: `v${v} - ${CHANGELOG[v].date}`, value: v }));
		}
	},
	execute: async function(interaction) {
		const input = interaction.options.getString('version') || 'latest';

		const majorMatch = input.match(/^(\d+)\.0$/);
		if (majorMatch) {
			const majorNum = majorMatch[1];
			const entries = Object.entries(CHANGELOG)
			.filter(([v]) => v.startsWith(`${majorNum}.`))
			.sort((a, b) => b[0].localeCompare(a[0]));

			if (!entries.length) {
				return { content: `No changelog found for major version \`${majorNum}.x\``, ephemeral: true };
			}

			const embed = {
				color: COLOR.PRIMARY,
				title: `Fox Box Insurance : v${majorNum}.x`,
				description: ''
			};

			for (const [ver, data] of entries) {
				embed.description += `**${ver}** - \`${data.date}\`\n`;
				embed.description += `${data.changes.map(x => `\\- ${x}`).join('\n')}\n\n`;
			}

			return { embeds: [embed] };
		}

		const version = input === 'latest' ? LATEST_VERSION : input;

		const data = CHANGELOG[version];
		if (!data) {
			console.error(`Changelog for version "${input}" not found`);
			return {
				content: `No changelog found for version \`${input}\``,
				ephemeral: true
			}
		}

		const embed = {
			color: COLOR.PRIMARY,
			title: `Fox Box Insurance : v${version}`,
			description: `
Updated: \`${data.date}\`

${data.changes.map(x => `\\- ${x}`).join('\n')}

https://github.com/MusicMakerOwO/FoxBoxInsurance/commits/main`
		};

		return { embeds: [embed] }
	}
} satisfies CommandHandler as CommandHandler;