import { describe, it, expect, vi, beforeEach } from 'vitest';

const { GetUser, SaveUser } = vi.hoisted(() => ({
	GetUser: vi.fn(),
	SaveUser: vi.fn()
}));
vi.mock('../CRUD/Users.js', () => ({ GetUser, SaveUser }));

vi.mock('../CRUD/TOSVersion.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../CRUD/TOSVersion.js')>();
	return { ...actual, GetTOSFeatures: vi.fn(actual.GetTOSFeatures) };
});

import { SetUserTOSVersion, CanUserAccessTOSFeature } from '../Services/UserTOS.js';
import { GetTOSFeatures } from '../CRUD/TOSVersion.js';
import { TOS_FEATURES, MAX_TOS_VERSION } from '../TOSConstants.js';
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
	vi.mocked(GetTOSFeatures).mockClear();
});

describe('SetUserTOSVersion', () => {
	it('sets the user\'s TOS version if user exists', async () => {
		const user = makeUser({ terms_version_accepted: 1 });
		GetUser.mockResolvedValue(user);

		await SetUserTOSVersion(user.id, 3);

		expect(user.terms_version_accepted).toBe(3);
		expect(SaveUser).toHaveBeenCalledWith(user);
	});

	it('throws if user does not exist', async () => {
		GetUser.mockResolvedValue(null);

		await expect(SetUserTOSVersion(1n, 3)).rejects.toThrow('User ID does not exist or cannot be accessed');
	});
});

describe('CanUserAccessTOSFeature', () => {
	it('returns false if user has not accepted any TOS version', () => {
		const user = makeUser({ terms_version_accepted: 0 });
		expect(CanUserAccessTOSFeature(user, TOS_FEATURES.MESSAGE_EXPORTS)).toBe(false);
	});

	it('returns true if user accepted a version greater than MAX_TOS_VERSION', () => {
		const user = makeUser({ terms_version_accepted: MAX_TOS_VERSION + 1 });
		expect(CanUserAccessTOSFeature(user, TOS_FEATURES.MESSAGE_EXPORTS)).toBe(true);
	});

	it('returns true if feature is included in accepted version', () => {
		// MESSAGE_EXPORTS was added in TOS version 1.
		const user = makeUser({ terms_version_accepted: 1 });
		expect(CanUserAccessTOSFeature(user, TOS_FEATURES.MESSAGE_EXPORTS)).toBe(true);
	});

	it('returns false if feature is not included in accepted version', () => {
		// SERVER_SNAPSHOTS is only added in TOS version 2.
		const user = makeUser({ terms_version_accepted: 1 });
		expect(CanUserAccessTOSFeature(user, TOS_FEATURES.SERVER_SNAPSHOTS)).toBe(false);
	});

	it('returns false if GetTOSFeatures returns null', () => {
		vi.mocked(GetTOSFeatures).mockReturnValueOnce(null);
		const user = makeUser({ terms_version_accepted: 1 });
		expect(CanUserAccessTOSFeature(user, TOS_FEATURES.MESSAGE_EXPORTS)).toBe(false);
	});
});
