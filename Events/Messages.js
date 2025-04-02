const SimplifyMessage = require('../Utils/Parsers/SimplifyMessage');
const { DownloadQueue, ASSET_TYPE } = require('../Utils/Processing/Images');

module.exports = {
	name: 'messageCreate',
	execute: async function(client, message) {
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