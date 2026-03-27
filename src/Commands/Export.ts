import {CommandHandler} from "../Typings/HandlerTypes";
import {COLOR, FORMAT} from "../Utils/Constants";
import {ButtonInteraction, GuildMember, SlashCommandBuilder} from "discord.js";
import {ProcessMessages} from "../Events/Messages";
import {CanMemberExportChannel} from "../Services/ExportAccess";
import {Database} from "../Database";
import {CreateExportCacheKey} from "../Typings/CacheEntries";
import {TOS_FEATURES} from "../TOSConstants";
import { GUILD_FEATURES } from "../Typings/DatabaseTypes";

const DISCORD_EPOCH_OFFSET = 1420070400000;
const DISCORD_ID_FILLING = BigInt( 0b1_1111_11111111_11111111 );

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [],
	response_type : 'reply',
	hidden        : true,
	aliases       : ['download'],
	data          : new SlashCommandBuilder()
		.setName('export')
		.setDescription('Export messages from the channel'),
	execute       : async function(interaction, client) {
		if ( ! await CanMemberExportChannel(interaction.member as GuildMember, interaction.channel!.id)) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					description: 'This channel cannot be exported - Please contact an admin'
				}]
			}
		}

		await ProcessMessages(); // save messages

		const channelMessageCount = await Database.query("SELECT COUNT(*) as count FROM Messages WHERE channel_id = ?", [ BigInt(interaction.channel!.id) ]).then(x => x[0].count ) as BigInt;
		if (channelMessageCount === 0n) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'No Messages Found',
					description: `
I couldn't find any messages in this channel to export
Try sending a message in the channel and try again

**FBI only saves messages sent after the bot was added to the server**`
				}]
			}
		}

		client.exportCache.set(
			CreateExportCacheKey(interaction.channelId, interaction.user.id),
			{
				guildID: BigInt(interaction.guildId!),
				channelID: BigInt(interaction.channelId),
				userID: BigInt(interaction.user.id),
				format: FORMAT.HTML,
				messageCount: Math.min(Number(channelMessageCount), 100),
				lastMessageID: (BigInt(Date.now() - DISCORD_EPOCH_OFFSET) << 22n) | DISCORD_ID_FILLING
			}
		);

		const main = client.buttons.get('export-main')!;
		return main.execute(interaction as unknown as ButtonInteraction, client, []);
	}
} satisfies CommandHandler as CommandHandler;