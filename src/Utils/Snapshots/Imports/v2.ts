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
		managed_by : 'string?'
	} as const satisfies JSONBlueprint;

	if (!CompareBlueprint(data, blueprint)) throw new Error(SNAPSHOT_ERRORS.BAD_DATA_TYPE);

	// https://support.discord.com/hc/en-us/articles/33694251638295-Discord-Account-Caps-Server-Caps-and-More#h_01K0YRW1XP13WNJE84D7J97VN7
	if (!ValidBigInt(data.id)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidString(data.name, { min_length: 2, max_length: 100 })) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidNumber(data.color, { min: 0x000000, max: 0xFFFFFF })) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidBoolean(data.hoist)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidNumber(data.position, { min: 0 })) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidBigInt(data.permissions)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (data.managed_by && !ValidBigInt(data.managed_by)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);

	return {
		id         : BigInt(data.id),
		name       : data.name,
		color      : data.color,
		hoist      : data.hoist,
		position   : data.position,
		permissions: BigInt(data.permissions),
		managed_by : data.managed_by ? BigInt(data.managed_by) : null
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
	if (!ValidString(data.name, { min_length: 2, max_length: 100 })) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
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
		id    : 'string',
		reason: 'string'
	} as const satisfies JSONBlueprint;

	if (!CompareBlueprint(data, blueprint)) throw new Error(SNAPSHOT_ERRORS.BAD_DATA_TYPE);

	if (!ValidBigInt(data.id)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidString(data.reason, { max_length: 1024 })) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);

	return {
		id    : BigInt(data.id),
		reason: data.reason
	}
}

// exposed only for testing purposes
export function ParsePermission(data: Record<string, unknown>): JSONStringify<SnapshotChannelOverwrite> {
	const blueprint = {
		allow: 'string',
		deny : 'string',
		type : 'number'
	} as const satisfies JSONBlueprint;

	if (!CompareBlueprint(data, blueprint)) throw new Error(SNAPSHOT_ERRORS.BAD_DATA_TYPE);

	if (!ValidBigInt(data.allow)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidBigInt(data.deny)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	if (!ValidNumber(data.type, { min: 0, max: 1 })) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);

	return {
		type : data.type as 0 | 1,
		allow: data.allow,
		deny : data.deny,
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
		version : 2,
		type    : SNAPSHOT_TYPE.IMPORT,
		channels: [],
		roles   : [],
		bans    : []
	}

	// make sure there are no additional fields
	const requiredFields = new Set(['id', 'type', 'version', 'channels', 'roles', 'bans']);
	const includedFields = Object.keys(importData);
	if (
		includedFields.length !== requiredFields.size ||
		includedFields.some(k => !requiredFields.has(k))
	) throw new Error(SNAPSHOT_ERRORS.MISMATCH_FIELDS);

	if (
		!Array.isArray(importData.channels) ||
		!Array.isArray(importData.roles) ||
		!Array.isArray(importData.bans)
	) throw new Error(SNAPSHOT_ERRORS.BAD_DATA_TYPE);

	const data = importData as {
		id: string,
		version: number,
		channels: unknown[],
		roles: unknown[],
		bans: unknown[],
	}

	for (const JSONRole of data.roles) {
		if (!isObject(JSONRole)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
		const role = ParseRole(JSONRole);
		snapshotData.roles.push(role);
	}

	for (const JSONChannel of data.channels) {
		if (!isObject(JSONChannel)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
		const channel = ParseChannel( Omit(JSONChannel, ['permission_overwrites']) );

		if (!('permission_overwrites' in JSONChannel)) throw new Error(SNAPSHOT_ERRORS.BAD_DATA_TYPE);
		if (JSONChannel.permission_overwrites === null || typeof JSONChannel.permission_overwrites !== 'object') throw new Error(SNAPSHOT_ERRORS.CORRUPTED);

		for (const [id, JSONOverwrite] of Object.entries(JSONChannel.permission_overwrites)) {
			const overwrite = ParsePermission(JSONOverwrite);
			// does the role actually exist?
			if (
				overwrite.type === OVERWRITE_TYPE.ROLE &&
				!snapshotData.roles.find(x => x.id.toString() === id)
			) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
			channel.permission_overwrites[id] = overwrite;
		}

		snapshotData.channels.push(channel);
	}

	for (const JSONBan of data.bans) {
		if (!isObject(JSONBan)) throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
		const ban = ParseBan(JSONBan);
		snapshotData.bans.push(ban);
	}

	return snapshotData;
}