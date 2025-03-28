// Need to delete unused data when the message data no longer exists

const { TASK, TASK_INTERVAL } = require("../Constants");
const Database = require("../Database");
const { success } = require("../Logs");
const Task = require("../TaskScheduler");

// Tables to check:
// - Emojis
// - Stickers
// - Attachments
// - Embeds
// - EmbedFields
// - MessageEmojis
module.exports = function CleanDatabase() {

	const start = process.hrtime.bigint();
	
	Database.exec('BEGIN TRANSACTION');

	Database.prepare(`
		DELETE FROM MessageEmojis
		WHERE message_id NOT IN (
			SELECT id FROM Messages
		)
	`).run();

	Database.prepare(`
		DELETE FROM Emojis
		WHERE id NOT IN (
			SELECT emoji_id FROM MessageEmojis
		)
	`).run();

	Database.prepare(`
		DELETE FROM Stickers
		WHERE id NOT IN (
			SELECT sticker_id FROM Messages
		)
	`).run();

	Database.prepare(`
		DELETE FROM Attachments
		WHERE message_id NOT IN (
			SELECT id FROM Attachments
		)
	`).run();

	Database.prepare(`
		DELETE FROM Embeds
		WHERE message_id NOT IN (
			SELECT id FROM Messages
		)
	`).run();

	Database.prepare(`
		DELETE FROM EmbedFields
		WHERE embed_id NOT IN (
			SELECT id FROM Embeds
		)
	`).run();

	Database.exec('COMMIT TRANSACTION');

	Database.exec('VACUUM');

	const end = process.hrtime.bigint();
	const duration = Number(end - start) / 1e6;
	success(`Cleaned database in ${duration.toFixed(2)} ms`);
}