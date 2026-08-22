import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('node:https', () => ({ default: { get } }));

function makeRequest() {
	const req = new EventEmitter() as EventEmitter & { destroy: () => void, end: () => void };
	req.destroy = vi.fn();
	req.end = vi.fn();
	return req;
}

beforeEach(() => {
	get.mockReset();
	// TestConnection caches its result for 60s in module-level state - reset the module
	// between tests so each test observes a fresh, uncached call to https.get.
	vi.resetModules();
});

describe('TestConnection', () => {
	it('treats a non-200 HTTP response as connected (DNS/TCP/TLS still worked)', async () => {
		const req = makeRequest();
		get.mockImplementation((_opts, callback) => {
			const res = new EventEmitter() as EventEmitter & { statusCode: number, destroy: () => void };
			res.statusCode = 404;
			res.destroy = vi.fn();
			queueMicrotask(() => callback(res));
			return req;
		});

		const { TestConnection } = await import('../Utils/TestConnection.js');
		await expect(TestConnection()).resolves.toBe(true);
	});

	it('treats a network-level error as disconnected', async () => {
		const req = makeRequest();
		get.mockImplementation(() => {
			queueMicrotask(() => req.emit('error', new Error('ECONNREFUSED')));
			return req;
		});

		const { TestConnection } = await import('../Utils/TestConnection.js');
		await expect(TestConnection()).resolves.toBe(false);
	});
});
