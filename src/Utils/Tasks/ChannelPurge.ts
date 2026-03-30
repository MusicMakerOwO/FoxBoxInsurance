import { Database } from "../../Database";
import { SECONDS } from "../Constants";
import { Log } from "../Log";
import { SimpleMessage } from "../../Typings/DatabaseTypes";

const MAX_MESSAGES_PER_CHANNEL = 10_000n;

export async function ChannelPurge(opts: { silent?: boolean } = {}) {
	const connection = await Database.getConnection();
	// any messages older than 60 days
	const expired =  new Date( Date.now() - SECONDS.DAY * 60 * 1000 );
	await connection.query("START TRANSACTION");

	const { affectedRows: expiredMessageCount } = await connection.query('DELETE FROM Messages WHERE created_at < ?', [expired]) as { affectedRows: bigint, insertId: bigint, warningStatus: number };
	const channelMessageCounts = await connection.query("SELECT COUNT(*) as message_count, channel_id FROM Messages GROUP BY channel_id") as { message_count: bigint, channel_id: SimpleMessage['channel_id'] }[];

	let overflowMessageCount = 0n;
	const promises: Promise<unknown>[] = [];
	for (const {channel_id, message_count} of channelMessageCounts) {
		if (message_count > MAX_MESSAGES_PER_CHANNEL) {
			const overflowAmount = message_count - MAX_MESSAGES_PER_CHANNEL;
			overflowMessageCount += overflowAmount;
			promises.push(
				connection.query(`
					DELETE FROM Messages
					WHERE channel_id = ?
					ORDER BY id ASC
					LIMIT ?
				`, [channel_id, overflowAmount])
			)
		}
	}

	await Promise.all(promises);

	// NOTE: This is a very slow query from my testing, ~400ms
	// This task should only run once a day at most so the performance impact is relatively low here
	// It is also faster than an individual query for each channel, so do with it what you will
	const { affectedRows: emptyChannels } = await connection.query('DELETE FROM Channels WHERE ( SELECT COUNT(*) FROM Messages WHERE channel_id = Channels.id ) = 0');

	await connection.query("COMMIT");
	Database.releaseConnection(connection);

	if (opts.silent) return;

	// little hack to count the total number of channels in db without a dedicated query
	Log('DELETE', `Checked ${channelMessageCounts.length + emptyChannels} channels`);
	Log('DELETE', ` - Deleted ${expiredMessageCount} expired messages`);
	Log('DELETE', ` - Deleted ${overflowMessageCount} overflow messages`);
	Log('DELETE', ` - Removed ${emptyChannels} empty channels`);
}