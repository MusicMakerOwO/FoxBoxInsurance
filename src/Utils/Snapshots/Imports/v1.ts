import { JSONSnapshot } from "../../../CRUD/Snapshots";
import { SNAPSHOT_ERRORS } from "./Errors";
import { SNAPSHOT_TYPE } from "../../Constants";
import {
	OVERWRITE_TYPE,
	SnapshotBan,
	SnapshotChannel, SnapshotChannelOverwrite,
	SnapshotExportMetadata,
	SnapshotRole
} from "../../../Typings/DatabaseTypes";
import { CompareBlueprint, JSONBlueprint } from "./CompareBlueprint";
import { ValidBigInt, ValidBoolean, ValidNumber, ValidString } from "./ParseUtils";
import { JSONStringify } from "../../../JSON";

function Omit<T extends object, K extends keyof T>(data: T, props: K[]): Omit<T, K> {
	const result = { ...data };
	for (const key of props) {
		delete result[key];
	}
	return result;
}

// exposed only for testing purposes
export function ParseRole(data: Record<string, unknown>): Omit<SnapshotRole, 'snapshot_id' | 'deleted'> {
	const blueprint = {
		id         : 'string',
		name       : 'string',
		color      : 'number',
		hoist      : 'number',
		position   : 'number',
		permissions: 'string',
		managed    : 'number'
	} as const satisfies JSONBlueprint;

	if (!CompareBlueprint(data, blueprint)) throw new Error(SNAPSHOT_ERRORS.BAD_DATA_TYPE);

	// https://support.discord.com/hc/en-us/articles/33694251638295-Discord-Account-Caps-Server-Caps-and-More#h_01K0YRW1XP13WNJE84D7J97VN7
	if (!ValidBigInt(data.id)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidString(data.name, { min_length: 1, max_length: 100 })) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidNumber(data.color, { min: 0x000000, max: 0xFFFFFF })) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidBoolean(data.hoist)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidNumber(data.position, { min: 0 })) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidBigInt(data.permissions)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidBoolean(data.managed)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);

	return {
		id         : BigInt(data.id),
		name       : data.name,
		color      : data.color,
		hoist      : data.hoist,
		position   : data.position,
		permissions: BigInt(data.permissions),
		managed_by : data.managed ? 1n : null
	}
}

// exposed only for testing purposes
export function ParseChannel(data: Record<string, unknown>): Omit<SnapshotChannel, 'snapshot_id' | 'deleted'> {
	const blueprint = {
		id       : 'string',
		type     : 'number',
		name     : 'string',
		position : 'number',
		nsfw     : 'number',
		topic    : 'string?',
		parent_id: 'string?'
	} as const satisfies JSONBlueprint;

	if (!CompareBlueprint(data, blueprint)) throw new Error(SNAPSHOT_ERRORS.BAD_DATA_TYPE);

	if (!ValidBigInt(data.id)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidString(data.name, { min_length: 1, max_length: 100 })) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidNumber(data.type, { min: 0 })) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidNumber(data.position, { min: 0 })) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidBoolean(data.nsfw)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (data.topic && !ValidString(data.topic, {
		min_length: 0,
		max_length: 1024
	})) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (data.parent_id && !ValidBigInt(data.parent_id)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);

	return {
		id       : BigInt(data.id),
		type     : data.type,
		name     : data.name,
		position : data.position,
		topic    : data.topic ?? null,
		nsfw     : +data.nsfw as 1 | 0,
		parent_id: data.parent_id ? BigInt(data.parent_id) : null,
		// Will be set in a later step since permissions are stored separately in the v1 format
		permission_overwrites: {}
	}
}

// exposed only for testing purposes
export function ParseBan(data: Record<string, unknown>): Omit<SnapshotBan, 'snapshot_id' | 'deleted'> {
	const blueprint = {
		user_id: 'string',
		reason : 'string'
	} as const satisfies JSONBlueprint;

	if (!CompareBlueprint(data, blueprint)) throw new Error(SNAPSHOT_ERRORS.BAD_DATA_TYPE);

	if (!ValidBigInt(data.user_id)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidString(data.reason, { max_length: 1024 })) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);

	return {
		id    : BigInt(data.user_id),
		reason: data.reason
	}
}

// exposed only for testing purposes
export function ParsePermission(data: Record<string, unknown>): JSONStringify<SnapshotChannelOverwrite> & {
	target_id: string,
	channel_id: string
} {
	const blueprint = {
		channel_id: 'string',
		role_id   : 'string',
		allow     : 'string',
		deny      : 'string'
	} as const satisfies JSONBlueprint;

	if (!CompareBlueprint(data, blueprint)) throw new Error(SNAPSHOT_ERRORS.BAD_DATA_TYPE);

	if (!ValidBigInt(data.channel_id)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidBigInt(data.role_id)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidBigInt(data.allow)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidBigInt(data.deny)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);

	return {
		channel_id: data.channel_id,
		target_id : data.role_id,

		allow     : data.allow,
		deny      : data.allow,
		/** I don't think it REALLY matters in the discord API but this info was never included in v1 anyway */
		type      : OVERWRITE_TYPE.ROLE
	}
}

function isObject(x: unknown): x is Record<string, unknown> {
	return x !== null && typeof x === 'object';
}

export default function Parse(metadata: SnapshotExportMetadata, importData: Record<string, unknown> & {
	id: string,
	version: number
}): JSONSnapshot {

	const snapshotData: JSONSnapshot = {
		id      : metadata.id,
		version : 1,
		type    : SNAPSHOT_TYPE.IMPORT,
		channels: [],
		roles   : [],
		bans    : []
	}

	// make sure there are no additional fields
	const requiredFields = new Set(['id', 'version', 'channels', 'roles', 'permissions', 'bans']);
	const includedFields = Object.keys(importData);
	if (
		includedFields.length !== requiredFields.size ||
		includedFields.some(k => !requiredFields.has(k))
	) throw new Error(SNAPSHOT_ERRORS.MISMATCH_FIELDS);

	if (
		!Array.isArray(importData.channels) ||
		!Array.isArray(importData.roles) ||
		!Array.isArray(importData.permissions) ||
		!Array.isArray(importData.bans)
	) throw new Error(SNAPSHOT_ERRORS.BAD_DATA_TYPE);

	const data = importData as {
		id: string,
		version: number,
		channels: unknown[],
		roles: unknown[],
		permissions: unknown[],
		bans: unknown[],
	}

	for (const JSONRole of data.roles) {
		if (!isObject(JSONRole)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
		// an unfortunate relic that v1 exports exposed a ton of extra data straight from the database
		// none of the data was harmful but it makes validation really difficult
		const role = ParseRole( Omit(JSONRole, ['snapshot_id', 'deleted', 'needsUpdate', 'hash' ]) );
		snapshotData.roles.push(role);
	}

	for (const JSONChannel of data.channels) {
		if (!isObject(JSONChannel)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
		const channel = ParseChannel( Omit(JSONChannel, ['snapshot_id', 'deleted', 'needsUpdate', 'hash' ]) );
		snapshotData.channels.push(channel);
	}

	for (const JSONBan of data.bans) {
		if (!isObject(JSONBan)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
		const ban = ParseBan( Omit(JSONBan, ['snapshot_id', 'deleted', 'needsUpdate', 'hash' ]) );
		snapshotData.bans.push(ban);
	}

	for (const JSONPermission of data.permissions) {
		if (!isObject(JSONPermission)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);

		const permission = ParsePermission( Omit(JSONPermission, ['snapshot_id', 'deleted', 'needsUpdate', 'hash', 'id' ]) );

		// The O(N) search within an O(N) validator technically makes this O(N^2)
		// But I really don't care enough because it would be a breaking change in 20 different places
		// and the 3ms max is completely reasonable timing
		const targetChannel = snapshotData.channels.find(x => x.id.toString() === permission.channel_id);
		if (!targetChannel) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
		// v1 never supported user overwrites so everything must be a role ID
		const targetRole = snapshotData.roles.find(x => x.id.toString() === permission.target_id);
		if (!targetRole) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);

		snapshotData.channels.find(x => x.id.toString() === permission.channel_id)!.permission_overwrites[permission.target_id] = permission;
	}

	return snapshotData;
}