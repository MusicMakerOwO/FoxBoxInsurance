const { SlashCommandBuilder } = require('@discordjs/builders');
const { SECONDS, COLOR } = require('../Utils/Constants');
const Database = require('../Utils/Database');

function CalculateUptime (seconds) {
	return {
		days: ~~(seconds / SECONDS.DAY),
		hours: ~~((seconds % SECONDS.DAY) / SECONDS.HOUR),
		minutes: ~~((seconds % SECONDS.HOUR) / SECONDS.MINUTE),
		seconds: ~~(seconds % 60)
	}
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('info')
		.setDescription('Display general bot information'),
	execute: async function(interaction, client) {
		await interaction.deferReply({ ephemeral: true }).catch(() => {});
		const processUptime = process.uptime(); // seconds
		const uptime = CalculateUptime(processUptime);

		const guilds = Database.prepare(`SELECT COUNT(*) FROM Guilds`).pluck().get();
		const channels = Array.from( client.guilds.cache.values() ).reduce((acc, guild) => acc + guild.channels.cache.size, 0);
		const users = Array.from( client.guilds.cache.values() ).reduce((acc, guild) => acc + guild.memberCount, 0);
		const messages = Database.prepare(`SELECT COUNT(*) FROM Messages`).pluck().get();

		const embed = {
			color: COLOR.PRIMARY,
			thumbnail: { url: client.user.displayAvatarURL({ size: 256 }) },
			title: 'Fox Bot Insurance',
			description: `
**Owner** : @musicmaker

**Servers** : ${guilds}
**Channels** : ${channels}
**Users** : ${users}

**Messages** : ${messages + client.messageCache.size}

**Uptime** : \`${uptime.days}d ${uptime.hours}h ${uptime.minutes}m ${uptime.seconds}s\`

**Support Server** : https://discord.gg/q7bUuVq4vB`
		}

		await interaction.editReply({ embeds: [embed] }).catch(() => {});
	}
}