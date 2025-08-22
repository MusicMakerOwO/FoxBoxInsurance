const Database = require('../Database');
const Log = require('../Logs');

const LinkTables = [
	'Guilds',
	'Users',
	'Emojis',
	'Stickers',
	'Attachments'
]

module.exports = async function LinkAssets () {
	const connection = await Database.getConnection();
	const start = process.hrtime.bigint();
	for (let i = 0; i < LinkTables.length; i++) {
		const targetTable = LinkTables[i];
		connection.query(`
			UPDATE ${targetTable} as asset
			SET asset_id = (
				SELECT asset_id
				FROM Assets
				WHERE discord_id = asset.id
			)
			WHERE asset_id IS NULL	
		`);
	}
	const end = process.hrtime.bigint();
	Database.releaseConnection(connection);
	Log.debug(`Linked assets in ${(Number(end - start) / 1e6).toFixed(3)}ms`);
}