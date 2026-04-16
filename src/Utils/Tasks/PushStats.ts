import {Database} from "../../Database";
import {Log} from "../Log";

export async function PushStats() {
	if (!process.env.API_KEY) return Log('ERROR', 'Missing API_KEY in .env file - Stats are disabled');
	if (process.env.DEV_MODE) return Log('DEBUG', 'Posting stats are disabled in dev mode');

	const connection = await Database.getConnection();

	const messageCount  = await connection.query('SELECT COUNT(*) as count FROM Messages ').then(rows => Number(rows[0].count));
	const guildCount    = await connection.query('SELECT COUNT(*) as count FROM Guilds   ').then(rows => Number(rows[0].count));
	const userCount     = await connection.query('SELECT COUNT(*) as count FROM Users    ').then(rows => Number(rows[0].count));
	const snapshotCount = await connection.query('SELECT COUNT(*) as count FROM Snapshots').then(rows => Number(rows[0].count));

	try {
		await fetch('https://api.notfbi.dev/stats', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'key': process.env.API_KEY,
			},
			body: JSON.stringify({
				shardID: 0, // I'll add sharding later lol
				guilds: guildCount,
				messages: messageCount,
				users: userCount,
				snapshots: snapshotCount
			})
		});
		Log('DEBUG', `Uploaded stats to API: ${guildCount} guilds, ${messageCount} messages, ${userCount} users`);
	} catch (error) {
		Log('ERROR', error);
	} finally {
		Database.releaseConnection(connection);
	}
}