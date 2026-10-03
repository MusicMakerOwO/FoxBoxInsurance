import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getConnection, createPool } = vi.hoisted(() => {
	const getConnection = vi.fn();
	const createPool = vi.fn(() => ({ getConnection }));
	return { getConnection, createPool };
});
vi.mock('mariadb', () => ({ createPool }));

const { Log } = vi.hoisted(() => ({ Log: vi.fn() }));
vi.mock('../Utils/Log.js', () => ({ Log }));

import { Database } from '../Database.js';

function makeConnection(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		query: vi.fn(() => new Promise(() => {})), // never resolves, simulating a stuck query
		batch: vi.fn(() => new Promise(() => {})),
		beginTransaction: vi.fn(async () => {}),
		commit: vi.fn(async () => {}),
		rollback: vi.fn(async () => {}),
		release: vi.fn(async () => {}),
		...overrides
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	process.env.MARIADB_URI = 'mariadb://test';
	getConnection.mockReset();
	createPool.mockClear();
	Log.mockReset();
	// force re-initialization so each test's mocked pool is picked up
	Database.connection_pool = undefined;
});

afterEach(() => {
	vi.useRealTimers();
});

describe('Database.query / batch / transaction leak tracking', () => {
	it('arms the stuck-connection warning for query()', async () => {
		const connection = makeConnection();
		getConnection.mockResolvedValue(connection);

		void Database.query('SELECT 1');
		await vi.advanceTimersByTimeAsync(10_000);

		expect(Log).toHaveBeenCalledWith('ERROR', expect.stringContaining('checked out for over 10 seconds'));
	});

	it('arms the stuck-connection warning for batch()', async () => {
		const connection = makeConnection();
		getConnection.mockResolvedValue(connection);

		void Database.batch('INSERT INTO x VALUES (?)', [[1]]);
		await vi.advanceTimersByTimeAsync(10_000);

		expect(Log).toHaveBeenCalledWith('ERROR', expect.stringContaining('checked out for over 10 seconds'));
	});

	it('arms the stuck-connection warning for transaction()', async () => {
		const connection = makeConnection({ beginTransaction: vi.fn(() => new Promise(() => {})) });
		getConnection.mockResolvedValue(connection);

		void Database.transaction(async () => {});
		await vi.advanceTimersByTimeAsync(10_000);

		expect(Log).toHaveBeenCalledWith('ERROR', expect.stringContaining('checked out for over 10 seconds'));
	});
});

describe('Database.getConnection disposal', () => {
	it('releases once when a `using` scope exits, and the warning never fires', async () => {
		const connection = makeConnection();
		getConnection.mockResolvedValue(connection);

		{
			using _connection = await Database.getConnection();
		}
		await vi.advanceTimersByTimeAsync(10_000);

		expect(connection.release).toHaveBeenCalledOnce();
		expect(Log).not.toHaveBeenCalled();
	});

	// mariadb's own asyncDispose calls the raw release() and would leave the warning armed
	it('routes `await using` through releaseConnection too', async () => {
		const connection = makeConnection();
		getConnection.mockResolvedValue(connection);

		{
			await using _connection = await Database.getConnection();
		}
		await vi.advanceTimersByTimeAsync(10_000);

		expect(connection.release).toHaveBeenCalledOnce();
		expect(Log).not.toHaveBeenCalled();
	});

	it('releases when the scope throws', async () => {
		const connection = makeConnection();
		getConnection.mockResolvedValue(connection);

		async function Throws() {
			using _connection = await Database.getConnection();
			throw new Error('query failed');
		}

		await expect(Throws()).rejects.toThrow('query failed');
		expect(connection.release).toHaveBeenCalledOnce();
	});

	it('does not release twice when released by hand inside a `using` scope', async () => {
		const connection = makeConnection();
		getConnection.mockResolvedValue(connection);

		{
			using checkedOut = await Database.getConnection();
			Database.releaseConnection(checkedOut);
		}

		expect(connection.release).toHaveBeenCalledOnce();
	});
});
