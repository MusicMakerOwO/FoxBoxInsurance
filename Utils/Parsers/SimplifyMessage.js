module.exports = function SimplifyMessage (message) {

	if (!message.guild) throw new Error(`Message is missing a guild - Is this from a DM?`);
	if (message.channel.type === 1 || message.channel.type === 3) throw new Error(`Message is from a DM - Ignoring`);

	const guildIcon = message.guild.iconURL({ size: 256 });
	const userIcon = message.author.displayAvatarURL({ size: 256 });
	
	const output = {
		guild: {
			id: message.guild.id,
			name: message.guild.name,
			icon: guildIcon
			? {
				id: /(\d{17,})/.exec(guildIcon)?.[0],
				name: 'icon',
				extension: /\.(gif|jpe?g|png)/.exec(guildIcon)?.[1], // gif, jpg, jpeg, png - If this is absent then discord made a goof and we have bigger problems
				url: guildIcon,
				height: 256, // could be smaller but we will fix that after downloading
				width: 256
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
			joinedAt: message.member?.joinedAt?.toISOString(), // you can't send a message without being in the server, this is always present lol
			icon: userIcon
			? {
				id: /(\d{17,})/.exec(userIcon)?.[0],
				name: 'icon',
				extension: userIcon.split('.').pop().split('?')[0],
				url: userIcon,
				height: 256, // could be smaller but we will fix that after downloading
				width: 256
			} : CalculateDefaultAvatar(message.author.id)
		},
		embeds: ProcessEmbeds(message.embeds, message.id),
		attachments: ProcessAttachments(message.attachments, message.id),
		sticker: ProcessSticker(message.stickers.first()),
		emojis: ProcessEmojis(message.content),
		id: message.id,
		content: message.content || null, // empty string converted to null,
		reply_to: message.reference?.messageId || null,
	}


	return output;
}


function CalculateDefaultAvatar(id) {
	const defaultAvatar = (BigInt(id) >> 22n) % 6n;
	return {
		id: id,
		name: 'default',
		extension: 'png',
		url: `https://cdn.discordapp.com/embed/avatars/${defaultAvatar}.png`,
		height: 256,
		width: 256
	}
}


function ProcessEmbeds(embeds, messageID) {
	const output = [];
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


function ProcessEmojis(content) {
	const output = [];
	
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
			height: 256,
			width: 256
		});
	}

	return output
}


function ProcessSticker(sticker) {
	if (!sticker) return null;
	return {
		id: sticker.id,
		description: sticker.description,
		format: Number(sticker.format),
		name: sticker.name,
		extension: 'png',
		url: `https://cdn.discordapp.com/stickers/${sticker.id}.png`,
		height: 256,
		width: 256
	}
}

function ProcessAttachments(attachment, messageID) {
	const output = [];

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
			width: file.width,
			height: file.height
		});
	}

	return output;
}