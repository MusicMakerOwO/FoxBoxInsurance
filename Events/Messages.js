const Database = require('../Utils/Database');
const SimplifyMessage = require('../Utils/Parsers/SimplifyMessage');
const { DownloadQueue, ASSET_TYPE } = require('../Utils/Processing/Images');

const accepted = new Map();
function AcceptedTerms(guildID) {
	if (accepted.has(guildID)) return accepted.get(guildID);
	// check database
	const terms = Database.prepare(`SELECT accepted_terms FROM Guilds WHERE id = ?`).pluck().get(guildID);
	accepted.set(guildID, terms || false);
	return terms || false;
}

module.exports = {
	name: 'messageCreate',
	execute: async function(client, message) {
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