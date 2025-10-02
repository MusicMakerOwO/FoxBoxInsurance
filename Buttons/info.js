const { COLOR, SECONDS } = require("../Utils/Constants");
const Database = require("../Utils/Database");

const { LATEST_VERSION } = require('../Commands/Changelog');

function CalculateUptime (seconds) {
	return {
		days: ~~(seconds / SECONDS.DAY),
		hours: ~~((seconds % SECONDS.DAY) / SECONDS.HOUR),
		minutes: ~~((seconds % SECONDS.HOUR) / SECONDS.MINUTE),
		seconds: ~~(seconds % 60)
	}
}

const statsButton = {
	type: 1,
	components: [{
		type: 2,
		style: 2,
		label: 'Message Stats',
		custom_id: 'global-stats',
		emoji: '📊'
	}]
}

module.exports = {
	customID: 'bot-info',
	execute: async function(interaction, client, args) {

		await interaction.deferUpdate().catch(() => {});

		const processUptime = process.uptime(); // seconds
		const uptime = CalculateUptime(processUptime);

		const connection = await Database.getConnection();

		const guilds = await connection.query(`SELECT COUNT(*) as count FROM Guilds`).then(rows => rows[0].count);
		const channels = Array.from( client.guilds.cache.values() ).reduce((acc, guild) => acc + guild.channels.cache.size, 0);
		const users = Array.from( client.guilds.cache.values() ).reduce((acc, guild) => acc + guild.memberCount, 0);
		const messages = await connection.query(`SELECT COUNT(*) as count FROM Messages`).then(rows => rows[0].count);

		const embed = {
			color: COLOR.PRIMARY,
			thumbnail: { url: client.user.displayAvatarURL({ size: 256 }) },
			title: 'Fox Bot Insurance',
			description: `
**Owner** : @musicmaker
**Version** : ${LATEST_VERSION}

**Servers** : ${guilds}
**Channels** : ${channels}
**Users** : ${users}

**Messages** : ${messages + BigInt(client.messageCache.size)}

**Uptime** : \`${uptime.days}d ${uptime.hours}h ${uptime.minutes}m ${uptime.seconds}s\`

**Support Server** : https://discord.gg/q7bUuVq4vB`
		}

		interaction.editReply({ embeds: [embed], components: [statsButton] });
	}
}