import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('node:https', () => ({ default: { request } }));

import { UploadCDN } from '../Utils/UploadCDN.js';

type FakeRequest = EventEmitter & { destroy: () => void, end: () => void, write: (data: Buffer, cb: (err: unknown) => void) => void };

function makeRequest(): FakeRequest {
	const req = new EventEmitter() as FakeRequest;
	req.destroy = vi.fn();
	req.end = vi.fn();
	req.write = vi.fn((_data, cb) => cb(null));
	return req;
}

beforeEach(() => {
	request.mockReset();
});

describe('UploadCDN', () => {
	it('sets a request timeout so the timeout handler can actually fire', async () => {
		const req = makeRequest();
		request.mockImplementation((opts) => {
			expect(opts.timeout).toBeGreaterThan(0);
			queueMicrotask(() => req.emit('timeout'));
			return req;
		});

		let rejected = false;
		await UploadCDN('file.png', Buffer.from('x'), null).catch(() => { rejected = true; });

		expect(rejected).toBe(true);
		expect(req.destroy).toHaveBeenCalled();
	});

	it('joins binary response chunks correctly instead of coercing them to strings', async () => {
		const req = makeRequest();
		request.mockImplementation((_opts, callback) => {
			const res = new EventEmitter() as EventEmitter & { statusCode: number };
			res.statusCode = 200;
			queueMicrotask(() => {
				callback(res);
				res.emit('data', Buffer.from('abc-'));
				res.emit('data', Buffer.from('hash'));
				res.emit('end');
			});
			return req;
		});

		await expect(UploadCDN('file.png', Buffer.from('x'), null)).resolves.toBe('abc-hash');
	});
});
