const { SlashCommandBuilder } = require('@discordjs/builders');
const { COLOR, FORMAT, RandomLoadingEmbed } = require('../Utils/Constants');
const ChannelCanExport = require('../Utils/Checks/ChannelCanExport');
const Database = require('../Utils/Database');
const ProcessMessages = require('../Utils/Processing/Messages');

const DEFAULT_OPTIONS = {
	bots: true,
	prettyPings: true,
	nicknames: false
}

const DISCORD_EPOCH_OFFSET = 1420070400000;
const DISCORD_ID_FILLING = BigInt( 0b1_1111_11111111_11111111 );

const NoExport = {
	color: COLOR.ERROR,
	description: 'This channel cannot be exported - Please contact an admin'
}

module.exports = {
	cooldown: 5,
	data: new SlashCommandBuilder()
		.setName('export')
		.setDescription('Export messages from the channel'),
	execute: async function(interaction, client) {
		await interaction.reply({ embeds: [RandomLoadingEmbed()], ephemeral: true });
		await new Promise(r => setTimeout(r, 2000));

		const blocked = Database.prepare("SELECT user_id FROM GuildBlocks WHERE guild_id = ? AND user_id = ?").pluck().get(interaction.guild.id, interaction.user.id);

		const canExport = interaction.member.permissions.has('Administrator') || !Database.prepare("SELECT block_exports FROM Channels WHERE id = ?").pluck().get(interaction.channel.id);
		if (blocked || !canExport) {
			await interaction.editReply({ embeds: [NoExport] });
			return;
		}
		
		ProcessMessages(client.messageCache); // save messages

		const channelMessageCount = Database.prepare("SELECT COUNT(*) FROM Messages WHERE channel_id = ?").pluck().get(interaction.channel.id);

		const exportOptions = {
			guildID: interaction.guild.id,
			channelID: interaction.channel.id,
			userID: interaction.user.id,
			format: FORMAT.HTML,
			messageCount: Math.min(channelMessageCount, 100),
			options: { ... DEFAULT_OPTIONS }, // we have to clone the object so we don't modify the original
			lastMessageID: String( (BigInt(Date.now() - DISCORD_EPOCH_OFFSET) << 22n) | DISCORD_ID_FILLING )
		}

		client.timedCache.set(`export_${interaction.guildId}_${interaction.channelId}_${interaction.user.id}`, exportOptions);

		const main = client.buttons.get('export-main');
		await main.execute(interaction, client, []);
	}
}