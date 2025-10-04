const https = require('https');
const Database = require('../Database');
const Log = require('../Logs');

module.exports = async function PushStats() {
	if (process.env.ENVIORNMENT === "DEV") return;

	const connection = await Database.getConnection();

	const messageCount = await connection.query('SELECT COUNT(*) as count FROM Messages').then(rows => Number(rows[0].count));
	const guildCount = await connection.query('SELECT COUNT(*) as count FROM Guilds').then(rows => Number(rows[0].count));
	const userCount = await connection.query('SELECT COUNT(*) as count FROM Users').then(rows => Number(rows[0].count));
	const snapshotCount = await connection.query('SELECT COUNT(*) as count FROM Snapshots').then(rows => Number(rows[0].count));

	try {
		await UploadStats(guildCount, messageCount, userCount, snapshotCount);
		Log.success(`Uploaded stats to API: ${guildCount} guilds, ${messageCount} messages, ${userCount} users`);
	} catch (error) {
		Log.error(error);
	} finally {
		Database.releaseConnection(connection);
	}
}

function UploadStats(guilds, messages, users, snapshots) {
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
			users: users,
			snapshots: snapshots
		}));
		request.end();
	});
}