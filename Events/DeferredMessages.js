module.exports = {
	name: 'messageUpdate',
	execute: async function(client, oldMessage, newMessage) {
		// if old message was from a deferred message, count it as a new message
		if (oldMessage.flags.has(128)) return client.emit('messageCreate', newMessage);
	}
}