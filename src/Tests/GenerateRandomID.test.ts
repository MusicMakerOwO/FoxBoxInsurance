import { describe, it, expect, vi } from 'vitest';
import { GenerateRandomID } from '../Utils/GenerateRandomID.js';
import { PoolConnection } from 'mariadb';

const fakeConnection = {} as PoolConnection;

describe('GenerateRandomID', () => {
	it('returns an XXXX-XXXX-XXXX-XXXX ID on the first non-colliding attempt', async () => {
		const exists = vi.fn().mockResolvedValue(false);

		const id = await GenerateRandomID(fakeConnection, exists);

		expect(id).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
		expect(exists).toHaveBeenCalledTimes(1);
		expect(exists).toHaveBeenCalledWith(fakeConnection, id);
	});

	it('retries with a new ID when exists() reports a collision', async () => {
		const seenIDs: string[] = [];
		const exists = vi.fn().mockImplementation(async (_connection: PoolConnection, id: string) => {
			seenIDs.push(id);
			return seenIDs.length < 3; // collide twice, then succeed
		});

		const id = await GenerateRandomID(fakeConnection, exists);

		expect(exists).toHaveBeenCalledTimes(3);
		expect(id).toBe(seenIDs[2]);
	});

	it('throws once the attempt budget is exhausted', async () => {
		const exists = vi.fn().mockResolvedValue(true); // always collides

		await expect(GenerateRandomID(fakeConnection, exists, 3)).rejects.toThrow();
		expect(exists).toHaveBeenCalledTimes(3);
	});

	it('never calls exists() when attempts is 0', async () => {
		const exists = vi.fn().mockResolvedValue(false);

		await expect(GenerateRandomID(fakeConnection, exists, 0)).rejects.toThrow();
		expect(exists).not.toHaveBeenCalled();
	});
});
