import {Guild} from "discord.js";
import {Database} from "../Database";
import {COLOR, SECONDS} from "../Utils/Constants";
import {LATEST_VERSION} from "../Commands/Changelog";
import {ButtonHandler} from "../Typings/HandlerTypes";

function CalculateUptime (seconds: number) {
	return {
		days: ~~(seconds / SECONDS.DAY),
		hours: ~~((seconds % SECONDS.DAY) / SECONDS.HOUR),
		minutes: ~~((seconds % SECONDS.HOUR) / SECONDS.MINUTE),
		seconds: ~~(seconds % 60)
	}
}

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'bot-info',
	execute       : async function(interaction, client) {

		const processUptime = process.uptime(); // seconds
		const uptime = CalculateUptime(processUptime);

		const connection = await Database.getConnection();

		const guilds = await connection.query(`SELECT COUNT(*) as count FROM Guilds`).then((rows: any) => rows[0].count) as bigint;
		const channels = Array.from<Guild>( client.guilds.cache.values() ).reduce((acc, guild) => acc + guild.channels.cache.size, 0);
		const users = Array.from<Guild>( client.guilds.cache.values() ).reduce((acc, guild) => acc + guild.memberCount, 0);
		const messages = await connection.query(`SELECT COUNT(*) as count FROM Messages`).then((rows: any) => rows[0].count) as bigint;

		const embed = {
			color: COLOR.PRIMARY,
			thumbnail: { url: client.user!.displayAvatarURL({ size: 256 }) },
			title: 'Fox Bot Insurance',
			description: `
**Owner** : @musicmaker
**Version** : ${LATEST_VERSION}

**Servers** : ${guilds}
**Channels** : ${channels}
**Users** : ${users}

**Messages** : ${messages}

**Uptime** : \`${uptime.days}d ${uptime.hours}h ${uptime.minutes}m ${uptime.seconds}s\`

**Support Server** : https://discord.gg/q7bUuVq4vB`
		}

		Database.releaseConnection(connection);

		return {
			embeds: [embed],
			components: [{
				type: 1,
				components: [{
					type: 2,
					style: 2,
					label: 'Message Stats',
					custom_id: 'global-stats',
					emoji: { name: '📊' }
				}]
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;