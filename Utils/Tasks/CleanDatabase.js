const Database = require("../Database");
const Log = require("../Logs");

module.exports = async function CleanDatabase() {

	const start = process.hrtime.bigint();

	let didDelete = 0;
	
	Database.exec('BEGIN TRANSACTION');

	Database.exec(`
		CREATE TEMP TABLE IF NOT EXISTS temp_messages AS SELECT id, sticker_id FROM Messages;
		CREATE TEMP TABLE IF NOT EXISTS temp_embeds AS SELECT DISTINCT id FROM Embeds;
	`);

	didDelete |= Database.prepare(`
		DELETE FROM MessageEmojis
		WHERE message_id NOT IN ( SELECT id FROM temp_messages )
	`).run().changes;

	// delete emojis that are not used in any message
	didDelete |= Database.prepare(`
		DELETE FROM Emojis
		WHERE id NOT IN (
			SELECT DISTINCT emoji_id FROM MessageEmojis
		)
	`).run().changes;

	didDelete |= Database.prepare(`
		DELETE FROM Stickers
		WHERE id NOT IN ( SELECT sticker_id FROM temp_messages )
	`).run().changes;

	didDelete |= Database.prepare(`
		DELETE FROM Attachments
		WHERE message_id NOT IN ( SELECT id FROM temp_messages )
	`).run().changes;

	didDelete |= Database.prepare(`
		DELETE FROM Embeds
		WHERE message_id NOT IN ( SELECT id FROM temp_messages )
	`).run().changes;

	didDelete |= Database.prepare(`
		DELETE FROM EmbedFields
		WHERE embed_id NOT IN ( SELECT DISTINCT id FROM temp_embeds)
	`).run().changes;

	Database.exec(`
		DROP TABLE IF EXISTS temp_messages;
		DROP TABLE IF EXISTS temp_embeds;
	`);

	Database.exec('COMMIT TRANSACTION');

	if (didDelete > 0) Database.exec('VACUUM');

	const end = process.hrtime.bigint();
	const duration = Number(end - start) / 1e6;
	Log.success(`Cleaned database in ${duration.toFixed(2)} ms`);
}