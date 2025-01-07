import BetterSqlite3, { Database } from 'better-sqlite3';

import fs from 'fs';

function ParseQueries(fileContent: string) : string[] {
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

const DB_SETUP_FILE = `${__dirname}/../../DB_SETUP.sql`;
const FileContent = fs.readFileSync(DB_SETUP_FILE, 'utf8');

const NoComments = FileContent.replace(/\-\-.*\n/g, '');

const MACROS: Record<string, string> = {
	ROOT_FOLDER: `${__dirname}../..`,
	SNOWFLAKE_DATE: `strftime('%Y-%m-%d %H:%M:%f', ((CAST(id AS INTEGER) >> 22) + 1420070400000) / 1000 - 21600, 'unixepoch')`
};

const WithMacros = NoComments.replace(/{{(.*?)}}/g, (match, macro) => {
	if (MACROS[macro]) return MACROS[macro];
	console.error(`Unknown macro: ${macro}`);
	return match;
});

const DBQueries = ParseQueries(WithMacros);

interface DBWithTables extends Database {
	tables: string[];
}

const database = new BetterSqlite3(`${__dirname}/../../fbi.sqlite`) as DBWithTables;

database.pragma('foreign_keys = OFF');
database.pragma('journal_mode = WAL');
database.pragma('synchronous = NORMAL');
database.pragma('cache_size = 10000');
database.pragma('temp_store = MEMORY');

for (let i = 0; i < DBQueries.length; i++) {
	try {
		database.exec( DBQueries[i] );
	} catch (error) {
		console.error( DBQueries[i] );
		console.error(error);
		process.exit(1);
	}
}

database.tables = database.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).pluck().all() as string[];

export default database;