const fs = require('node:fs');
const MariaDB = require('mariadb');
const { ROOT_FOLDER } = require('./Constants');
const { DB_SETUP_FILE, DB_FILE } = require('./Constants.js');
const Log = require('./Logs');

const connection_pool = MariaDB.createPool({
	host: process.env.MARIADB_HOST,
	user: process.env.MARIADB_USER,
	password: process.env.MARIADB_PASSWORD,
	database: 'FBI'
});

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

const DBQueries = ParseQueries(NoComments);

const connection_warning = new WeakMap(); // Connection => timeoutID
const connection_location = new WeakMap(); // Connection => stack trace

class Database {

	static async Initialize() {
		const connection = await Database.getConnection();
		for (let i = 0; i < DBQueries.length; i++) {
			try {
				await connection.query( DBQueries[i] );
			} catch (error) {
				console.error( DBQueries[i] );
				console.error(error);
				Database.releaseConnection(connection);
				process.exit(1);
			}
		}
		Database.releaseConnection(connection);
	}

	static async getConnection() {
		const connection = await connection_pool.getConnection();
		const timeoutID = setTimeout(() => {
			const stack = connection_location.get(connection);
			Log.error(`A database connection has been checked out for over 10 seconds. Did you forget to release it?${stack ? '\n' + stack : ''}`);
		}, 10_000);
		connection_warning.set(connection, timeoutID);
		connection_location.set(connection, new Error().stack.split('\n').slice(1).join('\n'));
		return connection;
	}

	static releaseConnection(connection) {
		// no await because we don't care about the result
		connection.release();

		clearTimeout( connection_warning.get(connection) );
		connection_warning.delete(connection);
	}

	static async query(sql, params = []) {
		const connection = await connection_pool.getConnection();
		const result = await connection.query(sql, params);
		Database.releaseConnection(connection);
		return result;
	}

	static async batch(sql, paramsArray = [[]]) {
		const connection = await connection_pool.getConnection();
		await connection.batch(sql, paramsArray);
		Database.releaseConnection(connection);
	}

	static async transaction(callback) {
		const connection = await connection_pool.getConnection();
		await connection.beginTransaction();
		await callback(connection);
		await connection.commit();
		Database.releaseConnection(connection);
	}

	static async destroy() {
		await connection_pool.end();
	}
}

module.exports = Database;