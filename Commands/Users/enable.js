const { SlashCommandBuilder } = require('@discordjs/builders');
const { COLOR, EMOJI } = require('../../Utils/Constants');
const Database = require('../../Utils/Database');

const NoPermissionsEmbed = {
	color: COLOR.ERROR,
	description: `
You do not have permission to use this command
You must be an administrator`
};

module.exports = {
	usage: '/enableuser <@user>',
	examples: [
		'/enableuser @user',
		'/enableuser 123456789012345678'
	],
	aliases: ['unblockuser'],
	data: new SlashCommandBuilder()
		.setName('enableuser')
		.setDescription('Allow a user to use exports')
		.addUserOption( x => x
			.setName('user')
			.setDescription('The user to unblock')
			.setRequired(true)
		),
	execute: async function(interaction, client) {

		await interaction.deferReply({ ephemeral: true }).catch(() => {});
		if (!interaction.member.permissions.has('Administrator')) {
			await interaction.editReply({ embeds: [NoPermissionsEmbed] }).catch(() => {});
			return;
		}

		const user = interaction.options.getUser('user');

		const guildId = interaction.guild.id;
		const userId = user.id;

		Database.prepare(`
			DELETE FROM GuildBlocks
			WHERE guild_id = ? AND user_id = ?
		`).run(guildId, userId);

		const embed = {
			color: COLOR.SUCCESS,
			description: `
**Status**: ${EMOJI.SUCCESS} Unblocked 
<@${userId}> can now export messages in this server`
		}
		
		await interaction.editReply({ embeds: [embed] }).catch(() => {});
	}
}