import { describe, it, expect, vi, beforeEach } from 'vitest';

const { GetUser, SaveUser } = vi.hoisted(() => ({
	GetUser: vi.fn(),
	SaveUser: vi.fn()
}));
vi.mock('../CRUD/Users.js', () => ({ GetUser, SaveUser }));

import { ResolveUserKey } from '../Services/UserEncryptionKeys.js';
import { SimpleUser } from '../Typings/DatabaseTypes.js';

function makeUser(overrides: Partial<SimpleUser> = {}): SimpleUser {
	return {
		id: 1n,
		username: 'test-user',
		bot: 0,
		terms_version_accepted: 0,
		wrapped_key: null,
		rotation_hour: 0,
		opt_out_collection: 0,
		...overrides
	};
}

beforeEach(() => {
	GetUser.mockReset();
	SaveUser.mockReset();
	process.env.PEPPER = Buffer.alloc(32, 1).toString('base64');
});

describe('ResolveUserKey', () => {
	it('propagates a failed save instead of returning a key that was never persisted', async () => {
		GetUser.mockResolvedValue(makeUser());
		SaveUser.mockRejectedValue(new Error('db unavailable'));

		await expect(ResolveUserKey(1n)).rejects.toThrow('db unavailable');
	});

	it('waits for the new key to be saved before returning it', async () => {
		GetUser.mockResolvedValue(makeUser());
		SaveUser.mockResolvedValue(undefined);

		const key = await ResolveUserKey(1n);

		expect(SaveUser).toHaveBeenCalled();
		expect(key).toBeInstanceOf(Buffer);
	});
});
