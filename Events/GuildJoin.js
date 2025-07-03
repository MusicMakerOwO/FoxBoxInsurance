const { SetGuildTOS } = require("../Utils/Caching/TOS");
const { COLOR } = require("../Utils/Constants");
const Database = require("../Utils/Database");
const { success, error } = require("../Utils/Logs");

module.exports = {
	name: 'guildCreate',
	execute: async function(client, guild) {
		success(`Joined new guild: ${guild.name} (${guild.id})`);

		Database.prepare(`
			INSERT INTO Guilds (id, name, accepted_terms)
			VALUES (?, ?, 0)
			ON CONFLICT(id) DO
			UPDATE SET name = excluded.name
		`).run(guild.id, guild.name);

		// Set the guild's TOS to false in the cache
		SetGuildTOS(guild.id, false);

		const WelcomeEmbed = {
			color: COLOR.PRIMARY,
			title: 'Thank you for using FBI!',
			description: `
To get started, you are required to accept the Terms of Service before using this bot.

By agreeing to the Terms you are agreeing to the following:
- You will not use this bot for illegal purposes
- You will not use the data for blackmail, harassment, doxxing, or any other malicious intent
- You will abide by the [Discord ToS](https://discord.com/terms) and [Community Guidelines](https://discord.com/guidelines)
- If you are caught violating these terms you will be banned from using this bot

**You can find a fully copy of the terms here : https://www.notfbi.dev/terms**`,
			footer: {
				text: `Fox Box Insurance : ${guild.name}`
			}
		}

		const USER_TOS_BUTTONS = {
			type: 1,
			components: [
				{
					type: 2,
					style: 4,
					label: 'Decline',
					custom_id: 'close'
				},
				{
					type: 2,
					style: 3,
					label: 'Accept',
					custom_id: `tos-accept_${guild.id}`
				}
			]
		}

		const owner = client.users.cache.get(guild.ownerId) ?? await client.users.fetch(guild.ownerId).catch(() => null);
		if (!owner) {
			error(`Could not find owner of guild ${guild.name} (${guild.id})`);
			return;
		}
		
		try {
			await owner.send({
				embeds: [WelcomeEmbed],
				components: [USER_TOS_BUTTONS]
			});
		} catch (e) {
			// DMs are closed :(
		}
	}
}