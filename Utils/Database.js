const fs = require('node:fs');
const BetterSqlite3 = require('better-sqlite3');
const { ROOT_FOLDER } = require('./Constants');
const { DB_SETUP_FILE, DB_FILE } = require('./Constants.js');

function ParseQueries(fileContent) {
	const queries = [];
	let buffer = '';
	let inMultilineComment = false;
	let insubQuery = false;

	const lines = fileContent.split('\n');
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i].trim();

		if (line.startsWith('--')) continue;

		if (line.startsWith('/*')) {
			inMultilineComment = true;
		}

		if (inMultilineComment) {
			if (line.endsWith('*/')) {
				inMultilineComment = false;
			}
			continue;
		}

		if (line.includes('BEGIN')) {
			insubQuery = true;
		}

		if (line.includes('END')) {
			insubQuery = false;
		}

		buffer += line + '\n';

		if (line.endsWith(';') && !insubQuery) {
			queries.push(buffer.trim());
			buffer = '';
		} else {
			buffer += ' ';
		}
	}

	// Check if there's any remaining content in the buffer (for cases where the file might not end with a semicolon)
	if (buffer.trim()) {
		queries.push(buffer.trim());
	}

	return queries;
}

const FileContent = fs.readFileSync(DB_SETUP_FILE, 'utf8');

const NoComments = FileContent.replace(/\-\-.*\n/g, '');

const MACROS = {
	ROOT_FOLDER: ROOT_FOLDER,
	SNOWFLAKE_DATE: `strftime('%Y-%m-%dT%H:%M:%fZ', ((CAST(id AS INTEGER) >> 22) + 1420070400000) / 1000, 'unixepoch')`,
	ISO_DATE: `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
};

const WithMacros = NoComments.replace(/{{(.*?)}}/g, (match, macro) => {
	if (MACROS[macro]) return MACROS[macro];
	console.error(`Unknown macro: ${macro}`);
	return match;
});

const DBQueries = ParseQueries(WithMacros);

const Database = new BetterSqlite3(DB_FILE);

Database.pragma('foreign_keys = OFF'); // Faster inserts but data integrity across tables is manual
Database.pragma('journal_mode = WAL');
Database.pragma('synchronous = NORMAL'); // Sacrifice some durability for speed
Database.pragma('cache_size = 50000');  // ~200MB cache
Database.pragma('temp_store = MEMORY'); // Use memory for temporary tables
Database.pragma('wal_autocheckpoint = 5000');
Database.pragma('mmap_size = 268435456'); // 256MB memory map

for (let i = 0; i < DBQueries.length; i++) {
	try {
		Database.exec( DBQueries[i] );
	} catch (error) {
		console.error( DBQueries[i] );
		console.error(error);
		process.exit(1);
	}
}

Database.tables = {}; // name -> column_name[]

const tables = Database.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).pluck().all();
for (let i = 0; i < tables.length; i++) {
	const tableName = tables[i];
	// { cid: number, name: string, type: string, notnull: number, dflt_value: any, pk: number }[]
	const columns = Database.prepare(`PRAGMA table_info(${tableName})`).all();
	Database.tables[tableName] = columns.map(column => column.name);
}

module.exports = Database;