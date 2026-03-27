import { describe, it, expect } from 'vitest';
import * as v2 from '../../Utils/Snapshots/Imports/v2';
import { SNAPSHOT_ERRORS } from '../../Utils/Snapshots/Imports/Errors';
import { OVERWRITE_TYPE, SnapshotExportMetadata } from "../../Typings/DatabaseTypes";
import { SNAPSHOT_TYPE } from "../../Utils/Constants";

describe('Roles', () => {
	it('parses a valid role object', () => {
		const input = {
			id         : '123456789012345678',
			name       : 'Admin',
			color      : 0xFFAA00,
			hoist      : 1,
			position   : 2,
			permissions: '987654321098765432',
			managed_by : '1'
		};
		const result = v2.ParseRole(input);
		expect(result)
		.toEqual({
			id         : 123456789012345678n,
			name       : 'Admin',
			color      : 0xFFAA00,
			hoist      : 1,
			position   : 2,
			permissions: 987654321098765432n,
			managed_by : 1n
		});
	});

	it('throws BAD_DATA_TYPE if blueprint does not match', () => {
		expect(() => v2.ParseRole({
			id         : '1',
			name       : 'Role',
			color      : 0,
			hoist      : 0,
			position   : 0,
			permissions: '1'
			// missing managed_by
		} as any))
		.toThrow(SNAPSHOT_ERRORS.BAD_DATA_TYPE);
	});

	it('throws CORRUPTED if id is not a valid bigint', () => {
		const input = {
			id         : 'notanumber',
			name       : 'Role',
			color      : 0,
			hoist      : 0,
			position   : 0,
			permissions: '1',
			managed_by : null
		};
		expect(() => v2.ParseRole(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});

	it('throws CORRUPTED if name is too short', () => {
		const input = {
			id         : '1',
			name       : 'A',
			color      : 0,
			hoist      : 0,
			position   : 0,
			permissions: '1',
			managed_by : null
		};
		expect(() => v2.ParseRole(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});

	it('throws CORRUPTED if name is too long', () => {
		const input = {
			id         : '1',
			name       : 'A'.repeat(128), // max 100
			color      : 0,
			hoist      : 0,
			position   : 0,
			permissions: '1',
			managed_by : null
		};
		expect(() => v2.ParseRole(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});

	it('throws CORRUPTED if color is out of range', () => {
		const input = {
			id         : '1',
			name       : 'Role',
			color      : -1,
			hoist      : 0,
			position   : 0,
			permissions: '1',
			managed_by : null
		};
		expect(() => v2.ParseRole(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);

		input.color = 0xFFFFFF + 1;
		expect(() => v2.ParseRole(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});

	it('throws CORRUPTED if hoist is not boolean-like', () => {
		const input = {
			id         : '1',
			name       : 'Role',
			color      : 0,
			hoist      : 2,
			position   : 0,
			permissions: '1',
			managed_by : null
		};
		expect(() => v2.ParseRole(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});

	it('throws CORRUPTED if position is negative', () => {
		const input = {
			id         : '1',
			name       : 'Role',
			color      : 0,
			hoist      : 0,
			position   : -1,
			permissions: '1',
			managed_by : null
		};
		expect(() => v2.ParseRole(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});

	it('throws CORRUPTED if permissions is not a valid bigint', () => {
		const input = {
			id         : '1',
			name       : 'Role',
			color      : 0,
			hoist      : 0,
			position   : 0,
			permissions: 'notabigint',
			managed_by : null
		};
		expect(() => v2.ParseRole(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});

	it('throws CORRUPTED if managed is not a valid bigint', () => {
		const input = {
			id         : '1',
			name       : 'Role',
			color      : 0,
			hoist      : 0,
			position   : 0,
			permissions: '1',
			managed_by : 'notabigint'
		};
		expect(() => v2.ParseRole(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});
});

describe('Channels', () => {
	it('parses a valid channel object with all fields', () => {
		const input = {
			id       : '123456789012345678',
			type     : 0,
			name     : 'general',
			position : 1,
			topic    : 'Welcome to the server!',
			nsfw     : 0,
			parent_id: '987654321098765432'
		};
		const result = v2.ParseChannel(input);
		expect(result)
		.toEqual({
			id                   : 123456789012345678n,
			type                 : 0,
			name                 : 'general',
			position             : 1,
			topic                : 'Welcome to the server!',
			nsfw                 : 0,
			parent_id            : 987654321098765432n,
			permission_overwrites: {}
		});
	});

	it('parses a valid channel object with optional values omitted', () => {
		const input = {
			id       : '1',
			type     : 0,
			name     : 'text',
			position : 0,
			nsfw     : 1,
			topic    : null,
			parent_id: null
		};
		const result = v2.ParseChannel(input);
		expect(result)
		.toEqual({
			id                   : 1n,
			type                 : 0,
			name                 : 'text',
			position             : 0,
			topic                : null,
			nsfw                 : 1,
			parent_id            : null,
			permission_overwrites: {}
		});
	});

	it('throws BAD_DATA_TYPE if blueprint does not match', () => {
		expect(() => v2.ParseChannel({
			id  : '1',
			type: 0,
			name: 'text',
			// missing position
			nsfw     : 1,
			topic    : null,
			parent_id: null
		} as any))
		.toThrow(SNAPSHOT_ERRORS.BAD_DATA_TYPE);
	});

	it('throws CORRUPTED if id is not a valid bigint', () => {
		const input = {
			id       : 'notanumber',
			type     : 0,
			name     : 'text',
			position : 0,
			nsfw     : 1,
			topic    : null,
			parent_id: null
		};
		expect(() => v2.ParseChannel(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});

	it('throws CORRUPTED if name is too short', () => {
		const input = {
			id       : '1',
			type     : 0,
			name     : '', // minimum length = 1
			position : 0,
			nsfw     : 1,
			topic    : null,
			parent_id: null
		};
		expect(() => v2.ParseChannel(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});

	it('throws CORRUPTED if type is negative', () => {
		const input = {
			id       : '1',
			type     : -1,
			name     : 'text',
			position : 0,
			nsfw     : 1,
			topic    : null,
			parent_id: null
		};
		expect(() => v2.ParseChannel(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});

	it('throws CORRUPTED if position is negative', () => {
		const input = {
			id       : '1',
			type     : 0,
			name     : 'text',
			position : -1,
			nsfw     : 1,
			topic    : null,
			parent_id: null
		};
		expect(() => v2.ParseChannel(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});

	it('throws CORRUPTED if nsfw is not boolean-like', () => {
		const input = {
			id       : '1',
			type     : 0,
			name     : 'text',
			position : 0,
			nsfw     : 2,
			topic    : null,
			parent_id: null
		};
		expect(() => v2.ParseChannel(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});

	it('throws CORRUPTED if topic is too long', () => {
		const input = {
			id       : '1',
			type     : 0,
			name     : 'text',
			position : 0,
			nsfw     : 1,
			topic    : 'a'.repeat(1025), // max 1024
			parent_id: null
		};
		expect(() => v2.ParseChannel(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});

	it('throws CORRUPTED if parent_id is not a valid bigint', () => {
		const input = {
			id       : '1',
			type     : 0,
			name     : 'text',
			position : 0,
			nsfw     : 1,
			topic    : null,
			parent_id: 'notabigint'
		};
		expect(() => v2.ParseChannel(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});
});

describe('Bans', () => {
	it('parses a valid ban object', () => {
		const input = {
			id    : '123456789012345678',
			reason: 'Spamming'
		};
		const result = v2.ParseBan(input);
		expect(result)
		.toEqual({
			id    : 123456789012345678n,
			reason: 'Spamming'
		});
	});

	it('parses a valid ban object with empty reason', () => {
		const input = {
			id    : '1',
			reason: ''
		};
		const result = v2.ParseBan(input);
		expect(result)
		.toEqual({
			id    : 1n,
			reason: ''
		});
	});

	it('throws BAD_DATA_TYPE if blueprint does not match', () => {
		expect(() => v2.ParseBan({
			id: '1'
			// missing reason
		} as any))
		.toThrow(SNAPSHOT_ERRORS.BAD_DATA_TYPE);
	});

	it('throws CORRUPTED if user_id is not a valid bigint', () => {
		const input = {
			id    : 'notanumber',
			reason: 'Rule violation'
		};
		expect(() => v2.ParseBan(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});

	it('throws CORRUPTED if reason is too long', () => {
		const input = {
			id    : '1',
			reason: 'a'.repeat(1025) // max 1024
		};
		expect(() => v2.ParseBan(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});
});

describe('Permissions', () => {
	it('parses a valid permission object', () => {
		const input = {
			allow: '111',
			deny : '222',
			type : OVERWRITE_TYPE.ROLE
		};
		const result = v2.ParsePermission(input);
		expect(result)
		.toEqual({
			allow: '111',
			deny : '222',
			type : OVERWRITE_TYPE.ROLE
		});
	});

	it('throws BAD_DATA_TYPE if blueprint does not match', () => {
		expect(() => v2.ParsePermission({
			allow: '1',
			deny : '2'
			// missing type
		} as any))
		.toThrow(SNAPSHOT_ERRORS.BAD_DATA_TYPE);
	});

	it('throws CORRUPTED if allow is not a valid bigint', () => {
		const input = {
			allow: 'notabigint',
			deny : '1',
			type : OVERWRITE_TYPE.ROLE
		};
		expect(() => v2.ParsePermission(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});

	it('throws CORRUPTED if deny is not a valid bigint', () => {
		const input = {
			allow: '1',
			deny : 'notabigint',
			type : OVERWRITE_TYPE.ROLE
		};
		expect(() => v2.ParsePermission(input))
		.toThrow(SNAPSHOT_ERRORS.CORRUPTED);
	});
});

describe('Parent object format validation', () => {
	const validMetadata = { id: 'metaid', version: 1 };
	const baseImport = {
		id      : 'importid',
		version : 1,
		type: 2,
		channels: [],
		roles   : [],
		bans    : []
	};

	it('throws MISMATCH_FIELDS if a required field is missing', () => {
		for (const field of ['channels', 'roles', 'bans'] as ('channels' | 'roles' | 'bans')[]) {
			const testImport = { ... baseImport };
			delete testImport[field];
			expect(() => v2.default(validMetadata as unknown as SnapshotExportMetadata, testImport))
			.toThrow(SNAPSHOT_ERRORS.MISMATCH_FIELDS);
		}
	});

	it('throws MISMATCH_FIELDS if extra fields are present', () => {
		const testImport = { ... baseImport, extra: 123 };
		expect(() => v2.default(validMetadata as unknown as SnapshotExportMetadata, testImport))
		.toThrow(SNAPSHOT_ERRORS.MISMATCH_FIELDS);
	});

	it('throws BAD_DATA_TYPE if any array field is not an array', () => {
		const notArrays = [null, 123, 'string', {}, undefined];
		for (const field of ['channels', 'roles', 'bans']) {
			for (const val of notArrays) {
				const testImport = { ... baseImport, [field]: val };
				expect(() => v2.default(validMetadata as unknown as SnapshotExportMetadata, testImport))
				.toThrow(SNAPSHOT_ERRORS.BAD_DATA_TYPE);
			}
		}
	});

	it('does not throw if all required fields are present and are arrays', () => {
		expect(() => v2.default(validMetadata as unknown as SnapshotExportMetadata, { ... baseImport }))
		.not
		.toThrow();
	});
});

it('can read and parse an entire snapshot without error', () => {
	// This is a real export from my test server, modified to make it as small and simple as possible
	const testImport = {
		"id"         : "MLLR-2RF7-WBK6-M25Y",
		"version"    : 2,
		"type"       : 2,
		"channels"   : [{
			"id"                   : "948331690042982410",
			"type"                 : 0,
			"name"                 : "general",
			"position"             : 11,
			"topic"                : null,
			"nsfw"                 : 0,
			"parent_id"            : "948331642701881394",
			"permission_overwrites": {
				"602329986463957025": { "allow": "0", "deny": "137438953472", "type": 0 },
				"846774996370325525": { "allow": "16", "deny": "0", "type": 0 }
			}
		}],
		"roles"      : [{
			"id"         : "602329986463957025",
			"name"       : "@everyone",
			"color"      : 0,
			"hoist"      : 0,
			"position"   : 0,
			"permissions": "2222085186641473",
			"managed_by" : null
		}, {
			"id"         : "846774996370325525",
			"name"       : "purpoe boi",
			"color"      : 7750874,
			"hoist"      : 0,
			"position"   : 58,
			"permissions": "6815211081",
			"managed_by" : null
		}, {
			"id"         : "1371231599819100364",
			"name"       : "Fox Box Insurance",
			"color"      : 0,
			"hoist"      : 0,
			"position"   : 61,
			"permissions": "137439267848",
			"managed_by" : "1065103018212732938"
		}],
		"bans"       : [{
			"id"    : "962640856953811006",
			"reason"     : "No reason provided",
		}]
	}

	const result = v2.default({
		id     : testImport.id,
		version: testImport.version
	} as unknown as SnapshotExportMetadata, testImport);
	expect(result)
	.toEqual({
		"id"      : testImport.id,
		"type"    : SNAPSHOT_TYPE.IMPORT,
		"version" : 2,
		"bans"    : [
			{
				"id"    : 962640856953811006n,
				"reason": "No reason provided"
			}
		],
		"channels": [
			{
				"id"                   : 948331690042982410n,
				"name"                 : "general",
				"nsfw"                 : 0,
				"parent_id"            : 948331642701881394n,
				"permission_overwrites": {
					"602329986463957025": { "allow": "0", "deny": "137438953472", "type": 0 },
					"846774996370325525": { "allow": "16", "deny": "0", "type": 0 }
				},
				"position"             : 11,
				"topic"                : null,
				"type"                 : 0
			}
		],
		"roles"   : [
			{
				"id"         : 602329986463957025n,
				"name"       : "@everyone",
				"position"   : 0,
				"color"      : 0,
				"hoist"      : 0,
				"permissions": 2222085186641473n,
				"managed_by" : null
			},
			{
				"id"         : 846774996370325525n,
				"name"       : "purpoe boi",
				"position"   : 58,
				"color"      : 7750874,
				"hoist"      : 0,
				"permissions": 6815211081n,
				"managed_by" : null
			},
			{
				"id"         : 1371231599819100364n,
				"name"       : "Fox Box Insurance",
				"position"   : 61,
				"color"      : 0,
				"hoist"      : 0,
				"permissions": 137439267848n,
				"managed_by" : 1065103018212732938n
			}
		]
	})
})