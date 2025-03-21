// Depending how long the channel is inactive, periodically delete messages
//
// Max of 10,000 messages per channel, delete the oldest ones first if exceeding
// 2 weeks of inactivity: keep 5,000 messages
// 1 month of inactivity: keep 1,000 messages
// 3 months of inactivity: keep 100 messages
// 6 months of inactivity: delete all messages and the channel data itself

const Database = require("../Database");
const { SECONDS } = require("../Constants");

const FindStaleChannels = Database.prepare("SELECT channel_id FROM Channels WHERE last_purge < ?");
const FindLastMessage = Database.prepare("SELECT created_at FROM Messages WHERE channel_id = ? ORDER BY message_id DESC LIMIT 1");

const UpdatePurgeTime = Database.prepare("UPDATE Channels SET last_purge = ? WHERE channel_id = ?");

const DeleteChannel = Database.prepare("DELETE FROM Channels WHERE channel_id = ?");
const DeleteMessages = Database.prepare("DELETE FROM Messages WHERE channel_id = ?");

const ChannelMessageCount = Database.prepare("SELECT COUNT(*) FROM Messages WHERE channel_id = ?");

const DeleteOldMessages = Database.prepare("DELETE FROM Messages WHERE channel_id = ? ORDER BY message_id ASC LIMIT ?");

module.exports = function ChannelPurge() {

	const start = process.hrtime.bigint();

	const ChannelsToPurge = FindStaleChannels.all( new Date().getSeconds() + SECONDS.WEEK );
	
	const now = new Date().getSeconds();

	let messagePurgeCount = 0;
	let channelPurgeCount = 0;
	let noopCount = 0;
	for (const channelID of ChannelsToPurge) {
		// check when the last message was, if it was in the last 2 weeks, skip
		const lastMessage = FindLastMessage.get(channelID); // local time string

		const lastMessageDate = new Date(lastMessage.created_at).getSeconds();
		const diffSeconds = now - lastMessageDate;

		if (diffSeconds > SECONDS.MONTH * 6) {
			DeleteMessages.run(channelID);
			DeleteChannel.run(channelID);
			channelPurgeCount++;
			continue;
		}
		
		UpdatePurgeTime.run(now, channelID);

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

		const storedMessageCount = ChannelMessageCount.pluck().get(channelID);

		const deleteCount = Math.max(0, storedMessageCount - keepCount);
		if (deleteCount <= 0) {
			noopCount++;
			continue;
		}

		messagePurgeCount += deleteCount;

		// delete the oldest messages first
		DeleteOldMessages.run(channelID, deleteCount);

		channelPurgeCount++;
	}

	const end = process.hrtime.bigint();
	const duration = Number(end - start) / 1e6;

	Log.debug(`Channel purge took ${duration.toFixed(2)}ms - Checked ${ChannelsToPurge.length} channels`);
	Log.debug(`\t- Delete ${messagePurgeCount} messages`);
	Log.debug(`\t- Deleted ${channelPurgeCount} channels`);
	Log.debug(`\t- Skipped ${noopCount} channels`);
}