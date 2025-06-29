const Database = require('../Utils/Database');
const SimplifyMessage = require('../Utils/Parsers/SimplifyMessage');
const { DownloadQueue, ASSET_TYPE } = require('../Utils/Processing/Images');

const accepted = new Set(); // is the guild exists always assume the terms are accepted
function AcceptedTerms(guildID) {
	if (accepted.has(guildID)) return true;
	const terms = Database.prepare(`SELECT accepted_terms FROM Guilds WHERE id = ?`).pluck().get(guildID);
	if (terms === 1) accepted.add(guildID);
	return terms === 1;
}

module.exports = {
	name: 'messageCreate',
	execute: async function(client, message) {
		if (!message.guild) return; // DM messages are not supported

		if (message.flags.has(128)) return; // deferred message

		const accepted = AcceptedTerms(message.guild.id);
		if (!accepted) return; // server owner must accept TOS before collecting data

		if (message.author.id === client.user.id) return; // self
		
		// Simplify the message to save on ram
		const simplified = SimplifyMessage(message);
		
		// add to cache to be bulk inserted later
		client.messageCache.add(simplified);

		// It is unlikely to change guilds, users, emojis, or stickers frequently
		// With that assumption, we will download 
		for (const file of simplified.attachments) {
			DownloadQueue.push({ type: ASSET_TYPE.ATTACHMENT, id: file.id, name: file.name, url: file.url, width: file.width, height: file.height });
		}
	}
}

module.exports.AcceptedCache = accepted;