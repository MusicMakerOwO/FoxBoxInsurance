const { SlashCommandBuilder } = require('@discordjs/builders');
const { COLOR, FORMAT, RandomLoadingEmbed } = require('../Utils/Constants');
const Database = require('../Utils/Database');
const { FlushMessages } = require('../Events/Messages');
const UserCanExport = require('../Utils/UserCanExport');
const { GetGuildTOS } = require('../Utils/Caching/TOS');

const DISCORD_EPOCH_OFFSET = 1420070400000;
const DISCORD_ID_FILLING = BigInt( 0b1_1111_11111111_11111111 );

const NoExport = {
	color: COLOR.ERROR,
	description: 'This channel cannot be exported - Please contact an admin'
}

const ServerTOSEmbed = {
	color: COLOR.ERROR,
	title: 'Export Disabled',
	description: "The server owners have not accepted FBI's Terms of Service yet.\n**No messages will be saved until these terms are accepted.**"
}

const NoMessagesEmbed = {
	color: COLOR.ERROR,
	title: 'No Messages Found',
	description: `
I couldn't find any messages in this channel to export
Try sending a message in the channel and try again

**FBI only saves messages sent after the bot was added to the server**`
}

module.exports = {
	aliases: ['download'],
	cooldown: 5,
	data: new SlashCommandBuilder()
		.setName('export')
		.setDescription('Export messages from the channel'),
	execute: async function(interaction, client) {
		await interaction.reply({ embeds: [RandomLoadingEmbed()], ephemeral: true });
		await new Promise(r => setTimeout(r, 2000));

		if ( ! await UserCanExport(interaction.member, interaction.channel.id)) {
			return interaction.editReply({ embeds: [NoExport] });
		}

		const serverAcceptedTOS = await GetGuildTOS(interaction.guild.id);
		if (!serverAcceptedTOS) {
			return interaction.editReply({
				embeds: [ ServerTOSEmbed ]
			});
		}

		await FlushMessages();

		const [{ "count": channelMessageCount }] = await Database.query("SELECT COUNT(*) as count FROM Messages WHERE channel_id = ?", [interaction.channel.id]);
		if (channelMessageCount === 0) {
			return interaction.editReply({
				embeds: [ NoMessagesEmbed ]
			});
		}

		const exportOptions = {
			guildID: interaction.guild.id,
			channelID: interaction.channel.id,
			userID: interaction.user.id,
			format: FORMAT.HTML,
			messageCount: Math.min(Number(channelMessageCount), 100),
			lastMessageID: String( (BigInt(Date.now() - DISCORD_EPOCH_OFFSET) << 22n) | DISCORD_ID_FILLING )
		}

		client.ttlcache.set(
			`export_${interaction.guildId}_${interaction.channelId}_${interaction.user.id}`,
			exportOptions
		);

		const main = client.buttons.get('export-main');
		return main.execute(interaction, client, []);
	}
}