const { Client } = require('discord.js');
module.exports = new Client({
	intents: [
		'Guilds',
		'GuildMembers',
		'MessageContent',
		'GuildMessages',
		'DirectMessages',
		'GuildBans'
	]
});