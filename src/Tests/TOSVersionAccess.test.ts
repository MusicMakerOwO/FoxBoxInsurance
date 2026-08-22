import { describe, it, expect } from 'vitest';
import { GetNextRequiredTOSVersion, BuildTOSChangeList } from '../CRUD/TOSVersion.js';
import { TOS_FEATURES, MAX_TOS_VERSION } from '../TOSConstants.js';

describe('GetNextRequiredTOSVersion', () => {
	it('returns the next required version if feature is added after user\'s version', () => {
		// DATA_COLLECTION_OPT_OUT is only added in TOS version 4; a user on version 3 needs it next.
		const result = GetNextRequiredTOSVersion([TOS_FEATURES.DATA_COLLECTION_OPT_OUT], { terms_version_accepted: 3 });
		expect(result).toBe(4);
	});

	it('returns null if no required version is greater than user\'s version', () => {
		// A user already on the latest TOS version has no future version to require.
		const result = GetNextRequiredTOSVersion([TOS_FEATURES.MESSAGE_EXPORTS], { terms_version_accepted: MAX_TOS_VERSION });
		expect(result).toBeNull();
	});

	it('returns the minimum version if all features have a common required version', () => {
		// MESSAGE_EXPORTS is available from v1 onward, TOS_VERSIONING only from v3 onward.
		// The earliest version satisfying both requirements at once is v3, not the earlier v2.
		const result = GetNextRequiredTOSVersion(
			[TOS_FEATURES.MESSAGE_EXPORTS, TOS_FEATURES.TOS_VERSIONING],
			{ terms_version_accepted: 1 }
		);
		expect(result).toBe(3);
	});
});

describe('BuildTOSChangeList', () => {
	it('returns a non-empty array if features were added between versions', () => {
		const result = BuildTOSChangeList(1, 2);
		expect(result).toEqual(['Added server snapshots', 'Added snapshot imports']);
	});

	it('returns a non-empty array if features were added or removed between versions', () => {
		const result = BuildTOSChangeList(1, 4);
		expect(result).toEqual([
			'Added server snapshots',
			'Added snapshot imports',
			'Added tos versioning',
			'Added opt out of data collection'
		]);
	});

	it('returns empty array if no changes between versions', () => {
		const result = BuildTOSChangeList(2, 2);
		expect(result).toEqual([]);
	});

	it('reports a feature removal even when it was added in a version before the requested range', () => {
		// Feature X added in v1, removed in v3 - a user upgrading from v2 to v3 should still be told it went away.
		const fakeVersions = {
			1: { date: '', added: [TOS_FEATURES.MESSAGE_EXPORTS], removed: [] },
			2: { date: '', added: [], removed: [] },
			3: { date: '', added: [], removed: [TOS_FEATURES.MESSAGE_EXPORTS] }
		};
		const fakeGetTOSFeatures = (version: number) => (version === 2 ? [TOS_FEATURES.MESSAGE_EXPORTS] : null);

		const result = BuildTOSChangeList(2, 3, fakeVersions, fakeGetTOSFeatures);
		expect(result).toEqual(['Removed message exports']);
	});
});
