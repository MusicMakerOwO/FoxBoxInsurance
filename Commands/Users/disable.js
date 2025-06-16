const { SlashCommandBuilder } = require('@discordjs/builders');
const { COLOR } = require('../../Utils/Constants');
const Database = require('../../Utils/Database');

/*
CREATE TABLE IF NOT EXISTS GuildBlocks (
	guild_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	moderator_id TEXT, -- NULL if automatic, ie. bot
	PRIMARY KEY (guild_id, user_id),
	created_at TEXT NOT NULL DEFAULT ({{ISO_DATE}})
) STRICT;
CREATE INDEX IF NOT EXISTS guild_blocks_guild_id ON GuildBlocks (guild_id);
CREATE INDEX IF NOT EXISTS guild_blocks_user_id  ON GuildBlocks (user_id);
*/

const NoPermissionsEmbed = {
	color: COLOR.ERROR,
	description: `
You do not have permission to use this command
You must be an administrator`
};

module.exports = {
	usage: '/disableuser <@user>',
	examples: [
		'/disableuser @user',
		'/disableuser 123456789012345678'
	],
	aliases: ['blockuser'],
	data: new SlashCommandBuilder()
		.setName('disableuser')
		.setDescription('Block a user from using exports')
		.addUserOption( x => x
			.setName('user')
			.setDescription('The user to block')
			.setRequired(true)
		),
	execute: async function(interaction, client) {

		await interaction.deferReply({ ephemeral: true }).catch(() => {});
		if (!interaction.member.permissions.has('Administrator')) {
			return interaction.editReply({ embeds: [NoPermissionsEmbed] });
		}

		const user = interaction.options.getUser('user');

		const guildId = interaction.guild.id;
		const userId = user.id;

		Database.prepare(`
			INSERT INTO GuildBlocks (guild_id, user_id, moderator_id)
			VALUES (?, ?, ?)
			ON CONFLICT(guild_id, user_id) DO NOTHING
		`).run(guildId, userId, interaction.user.id);

		const embed = {
			color: COLOR.PRIMARY,
			description: `
**Status**: ❌ Blocked
<@${userId}> can no longer export messages in this server`
		}

		interaction.editReply({ embeds: [embed] });
	}
}