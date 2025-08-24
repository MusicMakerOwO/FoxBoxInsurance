const { SECONDS } = require("../Constants");
const Database = require("../Database");
const Log = require("../Logs");

module.exports = async function CleanDatabase() {

	const start = process.hrtime.bigint();

	const connection = await Database.getConnection();

	// 30 days ago
	const isoDate = new Date(Date.now() - SECONDS.DAY * 30 * 1000).toISOString();

	await connection.beginTransaction();

	await connection.query(`CREATE TEMPORARY TABLE IF NOT EXISTS temp_messages AS SELECT id, sticker_id FROM Messages`);
	await connection.query(`CREATE TEMPORARY TABLE IF NOT EXISTS temp_embeds AS SELECT DISTINCT id FROM Embeds`);

	const transactionQueries = [
		connection.query(`
			DELETE FROM MessageEmojis
			WHERE message_id NOT IN ( SELECT id FROM temp_messages )
		`),

		// delete emojis that are not used in any message
		connection.query(`
			DELETE FROM Emojis
			WHERE id NOT IN (
				SELECT DISTINCT emoji_id FROM MessageEmojis
			)
		`),

		connection.query(`
			DELETE FROM Stickers
			WHERE id NOT IN ( SELECT sticker_id FROM temp_messages )
		`),

		connection.query(`
			DELETE FROM Attachments
			WHERE message_id NOT IN ( SELECT id FROM temp_messages )
		`),

		connection.query(`
			DELETE FROM Embeds
			WHERE message_id NOT IN ( SELECT id FROM temp_messages )
		`),

		connection.query(`
			DELETE FROM EmbedFields
			WHERE embed_id NOT IN ( SELECT DISTINCT id FROM temp_embeds)
		`),

		// delete interaction logs older than 30 days
		connection.query(`
			DELETE FROM InteractionLogs
			WHERE created_at < ?
		`, [isoDate])
	];

	await Promise.all(transactionQueries);

	await connection.query('DROP TABLE IF EXISTS temp_messages');
	await connection.query('DROP TABLE IF EXISTS temp_embeds');

	await connection.commit();

	Database.releaseConnection(connection);

	const end = process.hrtime.bigint();
	const duration = Number(end - start) / 1e6;
	Log.success(`Cleaned database in ${duration.toFixed(2)} ms`);
}