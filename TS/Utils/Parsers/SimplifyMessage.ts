/*
Message {
  channelId: '1087118874031427624',
  guildId: '602329986463957025',
  id: '1322420428802756671',
  createdTimestamp: 1735359999610,
  type: 0,
  system: false,
  content: 'abcde 💀 <:legend_smirk:1200443084341792918><a:death:809490758176079903>',
  author: User {
    id: '556949122003894296',
    bot: false,
    system: false,
    flags: UserFlagsBitField { bitfield: 4194432 },
    username: 'musicmaker',
    globalName: 'Music Maker',
    discriminator: '0',
    avatar: '7da6803394126ea8822e2d3a52341a2a',
    banner: undefined,
    accentColor: undefined,
    avatarDecoration: null,
    avatarDecorationData: null
  },
  pinned: false,
  tts: false,
  nonce: '1322420426915184640',
  embeds: [],
  components: [],
  attachments: Collection(2) [Map] {
    '1322420428228001864' => Attachment {
      attachment: 'https://cdn.discordapp.com/attachments/1087118874031427624/1322420428228001864/Stereo_Test_-_LeftRight_Audio_Test_for_HeadphonesSpeakers.mp3?ex=6770cf7f&is=676f7dff&hm=16044b56b9e651e084dc5c2418b80026b8f5e0d4510d4835d70873d6d65352fb&',
      name: 'Stereo_Test_-_LeftRight_Audio_Test_for_HeadphonesSpeakers.mp3',
      id: '1322420428228001864',
      size: 501061,
      url: 'https://cdn.discordapp.com/attachments/1087118874031427624/1322420428228001864/Stereo_Test_-_LeftRight_Audio_Test_for_HeadphonesSpeakers.mp3?ex=6770cf7f&is=676f7dff&hm=16044b56b9e651e084dc5c2418b80026b8f5e0d4510d4835d70873d6d65352fb&',
      proxyURL: 'https://media.discordapp.net/attachments/1087118874031427624/1322420428228001864/Stereo_Test_-_LeftRight_Audio_Test_for_HeadphonesSpeakers.mp3?ex=6770cf7f&is=676f7dff&hm=16044b56b9e651e084dc5c2418b80026b8f5e0d4510d4835d70873d6d65352fb&',
      height: null,
      width: null,
      contentType: 'audio/mpeg',
      description: null,
      ephemeral: false,
      duration: null,
      waveform: null,
      flags: AttachmentFlagsBitField { bitfield: 0 },
      title: 'Stereo Test - LeftRight Audio Test for HeadphonesSpeakers'
    },
    '1322420428874055752' => Attachment {
      attachment: 'https://cdn.discordapp.com/attachments/1087118874031427624/1322420428874055752/Charlie_optimized.png?ex=6770cf7f&is=676f7dff&hm=52b13dfd65275477d6f8755a55f4a6e8c65c195a7406472b5a10a3f2e30615c7&',
      name: 'Charlie_optimized.png',
      id: '1322420428874055752',
      size: 2989,
      url: 'https://cdn.discordapp.com/attachments/1087118874031427624/1322420428874055752/Charlie_optimized.png?ex=6770cf7f&is=676f7dff&hm=52b13dfd65275477d6f8755a55f4a6e8c65c195a7406472b5a10a3f2e30615c7&',
      proxyURL: 'https://media.discordapp.net/attachments/1087118874031427624/1322420428874055752/Charlie_optimized.png?ex=6770cf7f&is=676f7dff&hm=52b13dfd65275477d6f8755a55f4a6e8c65c195a7406472b5a10a3f2e30615c7&',
      height: 64,
      width: 64,
      contentType: 'image/png',
      description: null,
      ephemeral: false,
      duration: null,
      waveform: null,
      flags: AttachmentFlagsBitField { bitfield: 0 },
      title: null
    }
  },
  stickers: Collection(1) [Map] {
    '1161933251158487040' => Sticker {
      id: '1161933251158487040',
      description: null,
      type: null,
      format: 1,
      name: 'Pockyflump',
      packId: null,
      tags: null,
      available: null,
      guildId: null,
      user: null,
      sortValue: null
    }
  },
  position: null,
  roleSubscriptionData: null,
  resolved: null,
  editedTimestamp: null,
  reactions: ReactionManager { message: [Circular *1] },
  mentions: MessageMentions {
    everyone: false,
    users: Collection(0) [Map] {},
    roles: Collection(0) [Map] {},
    _members: null,
    _channels: null,
    _parsedUsers: null,
    crosspostedChannels: Collection(0) [Map] {},
    repliedUser: null
  },
  webhookId: null,
  groupActivityApplication: null,
  applicationId: null,
  activity: null,
  flags: MessageFlagsBitField { bitfield: 0 },
  reference: null,
  interactionMetadata: null,
  interaction: null,
  poll: null,
  call: null
}
*/

import { Message, Embed, Sticker } from 'discord.js';

import { BasicMessage, BasicAsset, EmojiAsset, BasicEmbed, StickerAsset, AttachmentAsset } from '../../typings';

export default function (message: Message) : BasicMessage {

	if (!message.guild) throw new Error(`Message is missing a guild - Is this from a DM?`);
	if (message.channel.type === 1 || message.channel.type === 3) throw new Error(`Message is from a DM - Ignoring`);

	const guildIcon = message.guild.iconURL({ size: 256 });
	const userIcon = message.author.displayAvatarURL({ size: 256 });
	
	const output: BasicMessage = {
		guild: {
			id: message.guild.id,
			name: message.guild.name,
			icon: guildIcon ? {
				id: /(\d{17,})/.exec(guildIcon)?.[0] as string,
				name: 'icon',
				extension: /\.(gif|jpe?g|png)/.exec(guildIcon)?.[1] as string, // gif, jpg, jpeg, png - If this is absent then discord made a goof and we have bigger problems
				url: guildIcon,
				dimensions: {
					height: 256, // could be smaller but we will fix that after downloading
					width: 256
				}
			} : null,
		},
		channel: {
			guildID: message.guild.id,
			id: message.channel.id,
			name: message.channel.name,
			type: message.channel.type,
			parentID: message.channel.parentId
		},
		user: {
			id: message.author.id,
			username: message.author.username,
			bot: message.author.bot,
			joinedAt: message.member?.joinedAt?.toISOString() as string, // you can't send a message without being in the server, this is always present lol
			icon: userIcon ? {
				id: /(\d{17,})/.exec(userIcon)?.[0] as string,
				name: 'icon',
				extension: userIcon.split('.').pop()!.split('?')[0],
				url: userIcon,
				dimensions: {
					height: 256, // could be smaller but we will fix that after downloading
					width: 256
				}
			} : CalculateDefaultAvatar(message.author.id)
		},
		embeds: ProcessEmbeds(message.embeds, message.id),
		attachments: ProcessAttachments(message.attachments, message.id),
		sticker: ProcessSticker(message.stickers.first()),
		emojis: ProcessEmojis(message.content),
		id: message.id,
		content: message.content,
	}


	return output;
}


function CalculateDefaultAvatar(id: string) : BasicAsset {
	const defaultAvatar = (BigInt(id) >> 22n) % 6n;
	return {
		id: id,
		name: 'default',
		extension: 'png',
		url: `https://cdn.discordapp.com/embed/avatars/${defaultAvatar}.png`,
		dimensions: {
			height: 256,
			width: 256
		}
	}
}


function ProcessEmbeds(embeds: Embed[], messageID: string) : BasicEmbed[] {
	const output: BasicEmbed[] = [];
	for (let i = 0; i < embeds.length; i++) {
		const embed = embeds[i];
		output.push({
			id: `${messageID}-${i}`,
			messageID: messageID,

			title: embed.title,
			description: embed.description,
			url: embed.url,
			timestamp: embed.timestamp,
			color: embed.color,

			footer_icon: embed.footer?.iconURL || null,
			footer_text: embed.footer?.text || null,

			thumbnail_url: embed.thumbnail?.url || null,

			image_url: embed.image?.url || null,

			author_name: embed.author?.name || null,
			author_url: embed.author?.url || null,
			author_icon: embed.author?.iconURL || null,

			fields: embed.fields // no work needed, already in the correct format lol
		});
	}
	return output;
}


function ProcessEmojis(content: string) : EmojiAsset[] {
	const output: EmojiAsset[] = [];
	
	// Most would only check if the content is empty
	// This takes it a step further and checks if the content is too short
	// Emojis are usually pretty long (20+ characters) so we can skip even more processing
	if (content.length < 20) return output;
	
	// NOTE: Default emojis are not included in this list as they are unicode characters
	const emojis = content.match(/<a?:\w+:(\d{17,})>/g);
	if (!emojis) return output;

	// const EmojiParser = /<(a?):(\w+):(\d{17,})>/;

	for (let i = 0; i < emojis.length; i++) {
		const emoji = emojis[i];

		// const emojiData = EmojiParser.exec(emoji);
		// if (!emojiData) continue;

		const emojiData = emoji.slice(1, -1).split(':')
		const animated = emojiData[0] === 'a';
		const name = emojiData[1];
		const id = emojiData[2];

		output.push({
			url: `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=256`,
			animated: animated,
			id: id,
			name: name,
			extension: animated ? 'gif' : 'png',
			dimensions: {
				height: 256,
				width: 256
			}
		});
	}

	return output
}


function ProcessSticker(sticker: Sticker | undefined) : StickerAsset | null {
	if (!sticker) return null;
	return {
		id: sticker.id,
		description: sticker.description,
		format: Number(sticker.format),
		name: sticker.name,
		extension: 'png',
		url: `https://cdn.discordapp.com/stickers/${sticker.id}.png`,
		dimensions: {
			height: 256,
			width: 256
		}
	}
}

function ProcessAttachments(attachment: Message['attachments'], messageID: string) : AttachmentAsset[] {
	const output: AttachmentAsset[] = [];

	const attachments = Array.from(attachment.values());
	for (let i = 0; i < attachments.length; i++) {
		const file = attachments[i];
		const [name, extension] = file.name.split('.');
		output.push({
			messageID: messageID,
			id: file.id,
			url: file.url,
			name: name,
			extension: extension,
			dimensions: file.width && file.height ? {
				height: file.height,
				width: file.width
			} : null
		});
	}

	return output;
}