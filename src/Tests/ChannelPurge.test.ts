import * as dotenv from "dotenv";
dotenv.config({ path: `${__dirname}/../../.env`, quiet: true });

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Database } from "../Database";
import { ChannelPurge } from "../Utils/Tasks/ChannelPurge";
import { GUILD_FEATURES, SimpleChannel } from "../Typings/DatabaseTypes";
import { SECONDS } from "../Utils/Constants";

const DISCORD_EPOCH = 1420070400000n;
const TEST_GUILD_ID = 991000000000000001n;
const TEST_USER_ID = 991000000000000002n;

type MessageSeed = {
	id: bigint,
	channelID: bigint,
	content?: string,
};

function CreateMessageID(date: Date, increment = 0) {
	return ((BigInt(date.getTime()) - DISCORD_EPOCH) << 22n) + BigInt(increment);
}

async function SeedBaseData() {
	await Database.query(`
		INSERT INTO Guilds (id, name, features)
		VALUES (?, ?, ?)
	`, [TEST_GUILD_ID, 'Channel Purge Test Guild', Object.values(GUILD_FEATURES).reduce((flags, flag) => flags | flag, 0)]);

	await Database.query(`
		INSERT INTO Users (id, username, bot)
		VALUES (?, ?, ?)
	`, [TEST_USER_ID, 'channel-purge-test-user', 0]);
}

async function InsertChannels(channels: bigint[]) {
	await Database.batch(`
		INSERT INTO Channels (id, guild_id, name, type)
		VALUES (?, ?, ?, ?)
	`, channels.map((id, index) => [id, TEST_GUILD_ID, `channel-${index + 1}`, 0]));
}

async function InsertMessages(messages: MessageSeed[]) {
	if (!messages.length) return;

	await Database.batch(`
		INSERT INTO Messages (id, guild_id, channel_id, user_id, content, sticker_id, reply_to, encryption_version, length, data)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, messages.map(({ id, channelID, content = 'hello' }) => [
		id,
		TEST_GUILD_ID,
		channelID,
		TEST_USER_ID,
		Buffer.from(content),
		null,
		null,
		null,
		content.length,
		{ attachments: [], emoji_ids: [], embeds: [], components: [] }
	]));
}

async function ClearTestData() {
	await Database.query('DELETE FROM Messages WHERE guild_id = ?', [TEST_GUILD_ID]);
	await Database.query('DELETE FROM Channels WHERE guild_id = ?', [TEST_GUILD_ID]);
	await Database.query('DELETE FROM Users WHERE id = ?', [TEST_USER_ID]);
	await Database.query('DELETE FROM Guilds WHERE id = ?', [TEST_GUILD_ID]);
}

describe('ChannelPurge', () => {
	beforeEach(async () => {
		await ClearTestData();
		await SeedBaseData();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('removes messages older than sixty days but keeps messages at the cutoff and newer', async () => {
		const now = new Date('2026-03-29T12:00:00.000Z');
		vi.useFakeTimers();
		vi.setSystemTime(now);

		const channelID = 991000000000000101n;
		const cutoff = new Date(now.getTime() - SECONDS.DAY * 60 * 1000);

		const olderThanCutoff = new Date(cutoff.getTime() - 1);
		const exactCutoff = new Date(cutoff.getTime());
		const newerThanCutoff = new Date(cutoff.getTime() + 1);

		await InsertChannels([channelID]);
		await InsertMessages([
			{ id: CreateMessageID(olderThanCutoff, 0), channelID, content: 'expired' },
			{ id: CreateMessageID(exactCutoff, 1), channelID, content: 'boundary' },
			{ id: CreateMessageID(newerThanCutoff, 2), channelID, content: 'recent' }
		]);

		await ChannelPurge({ silent: true });

		const remainingMessages = await Database.query(`
			SELECT id, content
			FROM Messages
			WHERE channel_id = ?
			ORDER BY id
		`, [channelID]) as { id: bigint, content: Buffer }[];

		expect(remainingMessages.map(message => message.id)).toEqual([
			CreateMessageID(exactCutoff, 1),
			CreateMessageID(newerThanCutoff, 2)
		]);
		expect(remainingMessages.map(message => message.content.toString())).toEqual(['boundary', 'recent']);
	});

	it('keeps only the newest ten thousand messages for overflowing channels', async () => {
		const now = new Date('2026-03-29T12:00:00.000Z');
		vi.useFakeTimers();
		vi.setSystemTime(now);

		const channelID = 991000000000000102n;
		await InsertChannels([channelID]);

		const messages: MessageSeed[] = [];
		for (let index = 0; index < 10_003; index++) {
			messages.push({
				id: CreateMessageID(new Date(now.getTime() - (10_003 - index) * 1000), index),
				channelID,
				content: `message-${index}`
			});
		}
		await InsertMessages(messages);

		await ChannelPurge({ silent: true });

		const remainingRows = await Database.query(`
			SELECT id
			FROM Messages
			WHERE channel_id = ?
			ORDER BY id
		`, [channelID]) as { id: bigint }[];

		expect(remainingRows).toHaveLength(10_000);
		expect(remainingRows[0].id).toBe(messages[3].id);
		expect(remainingRows.at(-1)?.id).toBe(messages.at(-1)?.id);

		const deletedRows = await Database.query(`
			SELECT COUNT(*) AS count
			FROM Messages
			WHERE channel_id = ? AND id IN (?, ?, ?)
		`, [channelID, messages[0].id, messages[1].id, messages[2].id]) as { count: bigint }[];
		expect(deletedRows[0].count).toBe(0n);
	});

	it('leaves channels at or below the limit untouched and removes channels with no remaining messages', async () => {
		const now = new Date('2026-03-29T12:00:00.000Z');
		vi.useFakeTimers();
		vi.setSystemTime(now);

		const exactLimitChannelID = 991000000000000103n;
		const belowLimitChannelID = 991000000000000104n;
		const emptiedByExpiryChannelID = 991000000000000105n;
		const alreadyEmptyChannelID = 991000000000000106n;
		await InsertChannels([exactLimitChannelID, belowLimitChannelID, emptiedByExpiryChannelID, alreadyEmptyChannelID]);

		const exactLimitMessages: MessageSeed[] = new Array(10_000).fill({});
		for (let index = 0; index < 10_000; index++) {
			exactLimitMessages[index] = {
				id: CreateMessageID(new Date(now.getTime() - (10_000 - index) * 1000), index),
				channelID: exactLimitChannelID,
				content: `limit-${index}`
			}
		}

		await InsertMessages([
			... exactLimitMessages,
			{ id: CreateMessageID(new Date(now.getTime() - 5_000), 10_001), channelID: belowLimitChannelID, content: 'fresh' },
			{ id: CreateMessageID(new Date(now.getTime() - SECONDS.DAY * 60 * 1000 - 1), 10_002), channelID: emptiedByExpiryChannelID, content: 'stale' }
		]);

		await ChannelPurge({ silent: true });

		const remainingChannels = await Database.query(`
			SELECT id
			FROM Channels
			WHERE guild_id = ?
			ORDER BY id
		`, [TEST_GUILD_ID]) as Pick<SimpleChannel, 'id'>[];
		expect(remainingChannels.map(channel => channel.id)).toEqual([
			exactLimitChannelID,
			belowLimitChannelID
		]);

		const messageCounts = await Database.query(`
			SELECT channel_id, COUNT(*) AS count
			FROM Messages
			WHERE guild_id = ?
			GROUP BY channel_id
			ORDER BY channel_id
		`, [TEST_GUILD_ID]) as { channel_id: bigint, count: bigint }[];
		expect(messageCounts).toEqual([
			{ channel_id: exactLimitChannelID, count: 10_000n },
			{ channel_id: belowLimitChannelID, count: 1n }
		]);
	});

	afterAll(async () => {
		await ClearTestData();
		await Database.destroy();
	});
});