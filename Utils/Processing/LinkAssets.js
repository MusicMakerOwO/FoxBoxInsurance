const Database = require('../Database');
const Log = require('../Logs');

const LinkTables = [
	'Guilds',
	'Users',
	'Emojis',
	'Stickers',
	'Attachments'
]

for (let i = 0; i < LinkTables.length; i++) {
	const table = LinkTables[i];
	if (!(table in Database.tables)) throw new Error(`Table ${table} does not exist in the database`);
	LinkTables[i] = Database.prepare(`
		UPDATE ${table} as asset
		SET asset_id = (
			SELECT asset_id
			FROM Assets
			WHERE discord_id = asset.id
		)
		WHERE asset_id IS NULL	
	`);
}

module.exports = function LinkAssets () {
	const start = process.hrtime.bigint();
	for (let i = 0; i < LinkTables.length; i++) {
		LinkTables[i].run();
	}
	const end = process.hrtime.bigint();
	Log.debug(`Linked assets in ${(Number(end - start) / 1e6).toFixed(3)}ms`);
}