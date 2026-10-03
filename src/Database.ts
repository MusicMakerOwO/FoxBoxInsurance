import {createPool, Pool, PoolConnection} from "mariadb";
import {Log} from "./Utils/Log.js";
import {Awaitable} from "./Typings/HelperTypes.js";

const connection_warning = new WeakMap(); // Connection => timeoutID
const connection_location = new WeakMap(); // Connection => stack trace

export type DisposableConnection = PoolConnection & Disposable & AsyncDisposable;

class DatabaseWrapper {
	connection_pool: Pool | undefined;

	async Initialize() {
		if (this.connection_pool) return;

		if (!process.env.MARIADB_URI) {
			Log('ERROR', 'Missing MARIADB_URI environment variable');
			// eslint-disable-next-line unicorn/no-process-exit
			process.exit(1);
		}

		// The connector decodes DATETIME columns as local time (see Utils/ProcessTimezone.ts), so the
		// session has to hand them over in the same clock this process runs on. Forcing it here means a
		// server whose global time_zone is not UTC cannot silently reintroduce the offset.
		const uri = process.env.MARIADB_URI;
		this.connection_pool = createPool(`${uri}${uri.includes('?') ? '&' : '?'}timezone=Z`);
	}

	/**
	 * Check out a connection for multi-statement work. Prefer `using connection = await Database.getConnection()`
	 * so it's released when the scope exits, throw or not; the manual `releaseConnection` pairing is legacy.
	 */
	async getConnection(): Promise<DisposableConnection> {
		await this.Initialize();

		const connection = await this.connection_pool!.getConnection() as DisposableConnection;
		const timeoutID = setTimeout(() => {
			const stack = connection_location.get(connection);
			Log('ERROR', `A database connection has been checked out for over 10 seconds. Did you forget to release it?${stack ? '\n' + stack : ''}`);
		}, 10_000);
		connection_warning.set(connection, timeoutID);
		connection_location.set(connection, new Error().stack!.split('\n').slice(1).join('\n'));

		// mariadb attaches its own asyncDispose, but it calls the raw release() and would leave the warning armed
		connection[Symbol.dispose] = () => Database.releaseConnection(connection);
		connection[Symbol.asyncDispose] = async () => Database.releaseConnection(connection);
		return connection;
	}

	releaseConnection(connection: PoolConnection) {
		// Already released - an explicit release inside a `using` scope must not hand it back to the pool twice
		if (!connection_warning.has(connection)) return;

		// no await because we don't care about the result
		void connection.release();

		clearTimeout( connection_warning.get(connection) );
		connection_warning.delete(connection);
	}

	async query(sql: string, params: unknown[] = []) {
		const connection = await this.getConnection();
		try {
			return await connection.query(sql, params);
		} finally {
			Database.releaseConnection(connection);
		}
	}

	async batch(sql: string, paramsArray: unknown[][] = [[]]) {
		const connection = await this.getConnection();
		try {
			await connection.batch(sql, paramsArray);
		} finally {
			Database.releaseConnection(connection);
		}
	}

	async transaction<T = void>(callback: (connection: PoolConnection) => Awaitable<T>): Promise<T> {
		const connection = await this.getConnection();
		try {
			await connection.beginTransaction();
			const result = await callback(connection);
			await connection.commit();
			return result;
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