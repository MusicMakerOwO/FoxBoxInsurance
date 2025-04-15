const { SECONDS, COLOR } = require("../Utils/Constants");
const Database = require("../Utils/Database");

const STAT_SIZE = 10_000;

const BackButton = {
	type: 1,
	components: [{
		type: 2,
		style: 4,
		label: 'Back',
		custom_id: 'bot-info',
	}]
}

let lastOutput = {};
let lastRun = 0;
function CalcuateMessageStats() {
	// only compute every 30 minutes
	if (Date.now() - lastRun < SECONDS.MINUTE * 1000 * 30) {
		return lastOutput;
	}

	const analytics = Database.prepare(`
WITH selected AS (
	SELECT id, user_id, guild_id, channel_id, content, sticker_id
	FROM Messages
	ORDER BY id DESC
	LIMIT ?
)
SELECT
	COUNT(*) AS message_count,
	COUNT(DISTINCT user_id) AS user_count,
	COUNT(DISTINCT guild_id) AS guild_count,
	COUNT(DISTINCT channel_id) AS channel_count,
	COUNT(DISTINCT sticker_id) AS sticker_count,

	ROUND(AVG(LENGTH(content)), 2) AS avg_length
FROM selected
	`).get(STAT_SIZE);

	const output = {
		color: COLOR.PRIMARY,
		title: 'Stats for nerds',
		description: `\`\`\`
Last ${analytics.message_count} messages
- Guilds: ${analytics.guild_count}
- Channels: ${analytics.channel_count}
- Users: ${analytics.user_count} (${(analytics.message_count / analytics.user_count).toFixed(2)} msg/user)

- Avg Length: ${analytics.avg_length} characters
\`\`\`
Last updated <t:${Math.floor(Date.now() / 1000)}:R>
Next update in <t:${Math.floor((Date.now() + SECONDS.MINUTE * 1000 * 30) / 1000)}:R>`
	}

	lastOutput = output;
	lastRun = Date.now();

	return output;
}

module.exports = {
	customID: 'global-stats',
	execute: async function(interaction, client, args) {
		// print stats for last 10k messages, cache the results
		const start = process.hrtime.bigint();
		const stats = CalcuateMessageStats();
		const end = process.hrtime.bigint();
		const elapsed = Number(end - start) / 1e6;
		console.log(`Stats calculated in ${elapsed.toFixed(3)}ms`);
		await interaction.update({ embeds: [stats], components: [BackButton], ephemeral: true }).catch(() => {});
	}
}