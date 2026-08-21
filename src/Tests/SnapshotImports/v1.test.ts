import { describe, it, expect } from 'vitest';
import Parse, { ParseRole, ParseChannel, ParseBan, ParsePermission } from '../../Utils/Snapshots/Imports/v1.js';
import { SNAPSHOT_ERRORS } from '../../Utils/Snapshots/Imports/Errors.js';
import { SNAPSHOT_TYPE } from '../../Utils/Constants.js';
import { OVERWRITE_TYPE, SnapshotExportMetadata } from '../../Typings/DatabaseTypes.js';

const metadata: SnapshotExportMetadata = {
	id: 'ABCD-EFGH-IJKL-MNOP',
	snapshot_id: 1,
	guild_id: 111n,
	user_id: 222n,
	length: 0,
	version: 1,
	hash: 'hash',
	algorithm: 'sha256',
	revoked: 0
};

function validRole(overrides: Record<string, unknown> = {}) {
	return {
		id: '100000000000000001',
		name: 'Moderator',
		color: 0xff0000,
		hoist: 1,
		position: 5,
		permissions: '8',
		managed: 0,
		...overrides
	};
}

function validChannel(overrides: Record<string, unknown> = {}) {
	return {
		id: '200000000000000001',
		type: 0,
		name: 'general',
		position: 0,
		nsfw: 0,
		topic: 'chat about things',
		parent_id: '300000000000000001',
		...overrides
	};
}

function validBan(overrides: Record<string, unknown> = {}) {
	return {
		user_id: '400000000000000001',
		reason: 'Spamming',
		...overrides
	};
}

function validPermission(overrides: Record<string, unknown> = {}) {
	return {
		channel_id: '200000000000000001',
		role_id: '100000000000000001',
		allow: '8',
		deny: '0',
		...overrides
	};
}

describe('SnapshotImports v1', () => {
	describe('Roles', () => {
		it('parses a valid role object', () => {
			expect(ParseRole(validRole())).toEqual({
				id: 100000000000000001n,
				name: 'Moderator',
				color: 0xff0000,
				hoist: 1,
				position: 5,
				permissions: 8n,
				managed_by: null
			});
		});

		it('sets managed_by to 1n if managed is truthy', () => {
			expect(ParseRole(validRole({ managed: 1 })).managed_by).toBe(1n);
		});

		it('throws BAD_DATA_TYPE if blueprint does not match', () => {
			const { color: _color, ...missingColor } = validRole();
			expect(() => ParseRole(missingColor)).toThrow(SNAPSHOT_ERRORS.BAD_DATA_TYPE);
		});

		it('throws CORRUPTED if id is not a valid bigint', () => {
			expect(() => ParseRole(validRole({ id: 'not-a-number' }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});

		it('throws CORRUPTED if name is too short', () => {
			expect(() => ParseRole(validRole({ name: '' }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});

		it('throws CORRUPTED if name is too long', () => {
			expect(() => ParseRole(validRole({ name: 'x'.repeat(101) }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});

		it('throws CORRUPTED if color is out of range', () => {
			expect(() => ParseRole(validRole({ color: 0x1000000 }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});

		it('throws CORRUPTED if hoist is not boolean-like', () => {
			expect(() => ParseRole(validRole({ hoist: 2 }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});

		it('throws CORRUPTED if position is negative', () => {
			expect(() => ParseRole(validRole({ position: -1 }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});

		it('throws CORRUPTED if permissions is not a valid bigint', () => {
			expect(() => ParseRole(validRole({ permissions: 'not-a-number' }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});

		it('throws CORRUPTED if managed is not boolean-like', () => {
			expect(() => ParseRole(validRole({ managed: 2 }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});
	});

	describe('Channels', () => {
		it('parses a valid channel object with all fields', () => {
			expect(ParseChannel(validChannel())).toEqual({
				id: 200000000000000001n,
				type: 0,
				name: 'general',
				position: 0,
				topic: 'chat about things',
				nsfw: 0,
				parent_id: 300000000000000001n,
				permission_overwrites: {}
			});
		});

		it('parses a valid channel object with optional values omitted', () => {
			expect(ParseChannel(validChannel({ topic: null, parent_id: null }))).toEqual({
				id: 200000000000000001n,
				type: 0,
				name: 'general',
				position: 0,
				topic: null,
				nsfw: 0,
				parent_id: null,
				permission_overwrites: {}
			});
		});

		it('throws BAD_DATA_TYPE if blueprint does not match', () => {
			const { name: _name, ...missingName } = validChannel();
			expect(() => ParseChannel(missingName)).toThrow(SNAPSHOT_ERRORS.BAD_DATA_TYPE);
		});

		it('throws CORRUPTED if id is not a valid bigint', () => {
			expect(() => ParseChannel(validChannel({ id: 'not-a-number' }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});

		it('throws CORRUPTED if name is too short', () => {
			expect(() => ParseChannel(validChannel({ name: '' }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});

		it('throws CORRUPTED if type is negative', () => {
			expect(() => ParseChannel(validChannel({ type: -1 }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});

		it('throws CORRUPTED if position is negative', () => {
			expect(() => ParseChannel(validChannel({ position: -1 }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});

		it('throws CORRUPTED if nsfw is not boolean-like', () => {
			expect(() => ParseChannel(validChannel({ nsfw: 2 }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});

		it('throws CORRUPTED if topic is too long', () => {
			expect(() => ParseChannel(validChannel({ topic: 'x'.repeat(1025) }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});

		it('throws CORRUPTED if parent_id is not a valid bigint', () => {
			expect(() => ParseChannel(validChannel({ parent_id: 'not-a-number' }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});
	});

	describe('Bans', () => {
		it('parses a valid ban object', () => {
			expect(ParseBan(validBan())).toEqual({ id: 400000000000000001n, reason: 'Spamming' });
		});

		it('parses with empty reason', () => {
			expect(ParseBan(validBan({ reason: '' }))).toEqual({ id: 400000000000000001n, reason: '' });
		});

		it('throws BAD_DATA_TYPE if blueprint does not match', () => {
			const { reason: _reason, ...missingReason } = validBan();
			expect(() => ParseBan(missingReason)).toThrow(SNAPSHOT_ERRORS.BAD_DATA_TYPE);
		});

		it('throws CORRUPTED if user_id is not a valid bigint', () => {
			expect(() => ParseBan(validBan({ user_id: 'not-a-number' }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});

		it('throws CORRUPTED if reason is too long', () => {
			expect(() => ParseBan(validBan({ reason: 'x'.repeat(1025) }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});
	});

	describe('Permissions', () => {
		it('parses a valid permission object', () => {
			expect(ParsePermission(validPermission())).toEqual({
				channel_id: '200000000000000001',
				target_id: '100000000000000001',
				allow: '8',
				deny: '0',
				type: OVERWRITE_TYPE.ROLE
			});
		});

		it('throws BAD_DATA_TYPE if blueprint does not match', () => {
			const { allow: _allow, ...missingAllow } = validPermission();
			expect(() => ParsePermission(missingAllow)).toThrow(SNAPSHOT_ERRORS.BAD_DATA_TYPE);
		});

		it('throws CORRUPTED if channel_id is not a valid bigint', () => {
			expect(() => ParsePermission(validPermission({ channel_id: 'not-a-number' }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});

		it('throws CORRUPTED if role_id is not a valid bigint', () => {
			expect(() => ParsePermission(validPermission({ role_id: 'not-a-number' }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});

		it('throws CORRUPTED if allow is not a valid bigint', () => {
			expect(() => ParsePermission(validPermission({ allow: 'not-a-number' }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});

		it('throws CORRUPTED if deny is not a valid bigint', () => {
			expect(() => ParsePermission(validPermission({ deny: 'not-a-number' }))).toThrow(SNAPSHOT_ERRORS.CORRUPTED);
		});
	});

	describe('Format validation', () => {
		function validImportData(overrides: Record<string, unknown> = {}) {
			return {
				id: metadata.id,
				version: 1,
				channels: [],
				roles: [],
				permissions: [],
				bans: [],
				...overrides
			};
		}

		it('throws MISMATCH_FIELDS if required field missing', () => {
			const { bans: _bans, ...missingBans } = validImportData();
			expect(() => Parse(metadata, missingBans)).toThrow(SNAPSHOT_ERRORS.MISMATCH_FIELDS);
		});

		it('throws MISMATCH_FIELDS if extra fields present', () => {
			expect(() => Parse(metadata, validImportData({ extra: true }))).toThrow(SNAPSHOT_ERRORS.MISMATCH_FIELDS);
		});

		it('throws BAD_DATA_TYPE if array fields are not arrays', () => {
			expect(() => Parse(metadata, validImportData({ channels: 'not-an-array' }))).toThrow(SNAPSHOT_ERRORS.BAD_DATA_TYPE);
		});

		it('does not throw if all fields valid', () => {
			expect(() => Parse(metadata, validImportData())).not.toThrow();
		});
	});

	it('can read and parse an entire snapshot without error', () => {
		const importData = {
			id: metadata.id,
			version: 1,
			roles: [validRole()],
			channels: [validChannel()],
			bans: [validBan()],
			permissions: [validPermission()]
		};

		const result = Parse(metadata, importData);

		expect(result.id).toBe(metadata.id);
		expect(result.version).toBe(1);
		expect(result.type).toBe(SNAPSHOT_TYPE.IMPORT);
		expect(result.roles).toHaveLength(1);
		expect(result.bans).toHaveLength(1);
		expect(result.channels).toHaveLength(1);
		expect(result.channels[0]!.permission_overwrites).toEqual({
			'100000000000000001': {
				channel_id: '200000000000000001',
				target_id: '100000000000000001',
				allow: '8',
				deny: '0',
				type: OVERWRITE_TYPE.ROLE
			}
		});
	});
});
