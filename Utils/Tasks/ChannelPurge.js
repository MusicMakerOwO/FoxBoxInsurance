// Depending how long the channel is inactive, periodically delete messages
//
// Max of 10,000 messages per channel, delete the oldest ones first if exceeding
// 2 weeks of inactivity: keep 5,000 messages
// 1 month of inactivity: keep 1,000 messages
// 3 months of inactivity: keep 100 messages
// 6 months of inactivity: delete all messages and the channel data itself

const Database = require("../Database");
const Log = require("../Logs");
const { SECONDS } = require("../Constants");

module.exports = async function ChannelPurge() {

	const start = process.hrtime.bigint();

	const connection = await Database.getConnection();

	const now = new Date().getSeconds();

	const ChannelsToPurge = (await connection.query("SELECT id FROM Channels WHERE last_purge < ?", [now + SECONDS.WEEK])).map(c => c.id);

	await connection.query("START TRANSACTION");

	const promiseQueue = [];

	let messagePurgeCount = 0;
	let channelPurgeCount = 0;
	let noopCount = 0;
	for (const channelID of ChannelsToPurge) {
		// check when the last message was, if it was in the last 2 weeks, skip
		const [lastMessage] = await connection.query("SELECT created_at FROM Messages WHERE channel_id = ? ORDER BY id DESC LIMIT 1", [channelID]); // local time string

		const lastMessageDate = new Date(lastMessage.created_at).getSeconds();
		const diffSeconds = now - lastMessageDate;

		if (diffSeconds > SECONDS.MONTH * 6) {
			// delete everything
			promiseQueue.push( connection.query("DELETE FROM Messages WHERE channel_id = ?", [channelID]) );
			promiseQueue.push( connection.query("DELETE FROM Channels WHERE id = ?", [channelID]) );
			channelPurgeCount++;
			continue;
		}

		promiseQueue.push( connection.query("UPDATE Channels SET last_purge = ? WHERE id = ?", [now, channelID]) );

		if (diffSeconds < SECONDS.WEEK * 2) {
			noopCount++;
			continue;
		}

		let keepCount = 0;

		if (diffSeconds > SECONDS.MONTH * 3) {
			keepCount = 100;
		} else if (diffSeconds > SECONDS.MONTH) {
			keepCount = 1000;
		} else if (diffSeconds > SECONDS.WEEK * 2) {
			keepCount = 5000;
		}

		const [{ count: storedMessageCount }] = await connection.query("SELECT COUNT(*) as count FROM Messages WHERE channel_id = ?", [channelID]);

		const deleteCount = Math.max(0, storedMessageCount - keepCount);
		if (deleteCount <= 0) {
			noopCount++;
			continue;
		}

		messagePurgeCount += deleteCount;

		// delete the oldest messages first
		promiseQueue.push( connection.query("DELETE FROM Messages WHERE channel_id = ? ORDER BY id ASC LIMIT ?", [channelID, deleteCount]) );

		channelPurgeCount++;
	}

	await Promise.all(promiseQueue);

	connection.query("COMMIT TRANSACTION");
	Database.releaseConnection(connection);

	const end = process.hrtime.bigint();
	const duration = Number(end - start) / 1e6;

	Log.success(`Channel purge took ${duration.toFixed(2)}ms`);
	Log.success(` - Checked ${ChannelsToPurge.length} channels`);
	Log.success(` - Deleted ${messagePurgeCount} messages`);
	Log.success(` - Deleted ${channelPurgeCount} channels`);
	Log.success(` - Skipped ${noopCount} channels`);
}