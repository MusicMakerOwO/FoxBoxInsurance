const https = require('https');
const Database = require('../Database');
const Log = require('../Logs');

module.exports = async function PushStats() {
	const messageCount = Database.prepare('SELECT COUNT(*) FROM messages').pluck().get();
	const guildCount = Database.prepare('SELECT COUNT(*) FROM guilds').pluck().get();
	const userCount = Database.prepare('SELECT COUNT(*) FROM users').pluck().get();

	try {
		await UploadStats(guildCount, messageCount, userCount);
		Log.success(`Uploaded stats to API: ${guildCount} guilds, ${messageCount} messages, ${userCount} users`);
	} catch (error) {
		Log.error(error);
	}
}

function UploadStats(guilds, messages, users) {
	return new Promise((resolve, reject) => {
		const request = https.request('https://api.notfbi.dev/stats', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'key': process.env.API_KEY
			}
		}, (res) => {
			const data = [];
			res.on('data', data.push.bind(data));
			res.on('end', () => {
				const response = Buffer.concat(data).toString();
				if (res.statusCode === 200) {
					resolve(JSON.parse(response));
				} else {
					reject(new Error(`Failed to upload stats: ${res.statusCode} - ${response}`));
				}
			});
		});
		request.on('error', (error) => {
			request.destroy();
			reject(new Error(error));
		});
		request.write(JSON.stringify({
			shardID: 0, // I'll add sharding later lol
			guilds: guilds,
			messages: messages,
			users: users
		}));
		request.end();
	});
}