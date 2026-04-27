import {createPool, Pool, PoolConnection} from "mariadb";
import {Log} from "./Utils/Log";
import {Awaitable} from "./Typings/HelperTypes";

const connection_warning = new WeakMap(); // Connection => timeoutID
const connection_location = new WeakMap(); // Connection => stack trace

class DatabaseWrapper {
	connection_pool: Pool | undefined;

	async Initialize() {
		if (this.connection_pool) return;

		if (!process.env.MARIADB_URI) {
			console.log('[!] Missing MARIADB_URI environment variable');
			process.exit(1);
		}

		this.connection_pool = createPool(process.env.MARIADB_URI);
	}

	async getConnection() {
		await this.Initialize();

		const connection = await this.connection_pool!.getConnection();
		const timeoutID = setTimeout(() => {
			const stack = connection_location.get(connection);
			Log('ERROR', `A database connection has been checked out for over 10 seconds. Did you forget to release it?${stack ? '\n' + stack : ''}`);
		}, 10_000);
		connection_warning.set(connection, timeoutID);
		connection_location.set(connection, new Error().stack!.split('\n').slice(1).join('\n'));
		return connection;
	}

	releaseConnection(connection: PoolConnection) {
		// no await because we don't care about the result
		void connection.release();

		clearTimeout( connection_warning.get(connection) );
		connection_warning.delete(connection);
	}

	async query(sql: string, params: unknown[] = []) {
		await this.Initialize();

		const connection = await this.connection_pool!.getConnection();
		try {
			return await connection.query(sql, params);
		} finally {
			Database.releaseConnection(connection);
		}
	}

	async batch(sql: string, paramsArray: unknown[][] = [[]]) {
		await this.Initialize();

		const connection = await this.connection_pool!.getConnection();
		try {
			await connection.batch(sql, paramsArray);
		} finally {
			Database.releaseConnection(connection);
		}
	}

	async transaction(callback: (connection: PoolConnection) => Awaitable<void>) {
		await this.Initialize();

		const connection = await this.connection_pool!.getConnection();
		try {
			await connection.beginTransaction();
			await callback(connection);
			await connection.commit();
		} catch (error) {
			await connection.rollback();
			throw error;
		} finally {
			Database.releaseConnection(connection);
		}
	}

	async destroy() {
		if (this.connection_pool) await this.connection_pool.end();
	}
}

export const Database = new DatabaseWrapper();