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
