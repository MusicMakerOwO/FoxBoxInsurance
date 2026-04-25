import {SnapshotExportMetadata} from "../../../Typings/DatabaseTypes";
import {JSONSnapshot} from "../../../CRUD/Snapshots";
import {LRUCache} from "../../DataStructures/LRUCache";
import {SNAPSHOT_ERRORS} from "./Errors";
import {Database} from "../../../Database";
import {createHash} from "node:crypto";

import v1 from "./v1";
import v2 from "./v2";

export const SnapshotParsers: Record<number, (metadata: SnapshotExportMetadata, data: Record<string, unknown> & { id: string, version: number }) => JSONSnapshot> = {
	1: v1,
	2: v2
} as const

const cache = new LRUCache<string, JSONSnapshot>(100);

function HasRequiredFields(data: object): data is { id: string, version: number } {
	return (
		('id'      in data && typeof data.id      === 'string') &&
		('version' in data && typeof data.version === 'number')
	);
}

export async function BuildSnapshotFromImport(input: unknown) {
	if (!input || typeof input !== "object") throw new Error(SNAPSHOT_ERRORS.BAD_DATA_TYPE);
	if (!HasRequiredFields(input)) throw new Error(SNAPSHOT_ERRORS.BAD_DATA_TYPE);

	// prevent prototype pollution
	const data = DeepFreeze(input);

	const parseImport = SnapshotParsers[data.version];
	if (!parseImport) throw new Error('Unknown export version, unable to convert snapshot');

	if (cache.has(data.id)) return cache.get(data.id)!;

	const exportMetadata = await Database.query(`SELECT * FROM SnapshotExports WHERE id = ?`, [data.id]).then(x => x[0]) as SnapshotExportMetadata | null;
	if (!exportMetadata || exportMetadata.revoked) throw new Error('Something went wrong trying to parse the snapshot');

	const str = JSON.stringify(data);
	if (exportMetadata.length !== str.length) {
		void Database.query('UPDATE SnapshotExports SET revoked = ? WHERE id = ?', [true, exportMetadata.id]);
		throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	}

	const hash = createHash(exportMetadata.algorithm).update(str).digest('hex');
	if (exportMetadata.hash !== hash) {
		void Database.query('UPDATE SnapshotExports SET revoked = ? WHERE id = ?', [true, exportMetadata.id]);
		throw new Error(SNAPSHOT_ERRORS.CORRUPTED);
	}

	const snapshotData = parseImport(exportMetadata, data);
	cache.set(data.id, snapshotData);
	return snapshotData;
}

function DeepFreeze<T extends {}>(obj: T) {
	Object.freeze(obj);
	for (const key of Object.keys(obj) as (keyof T)[]) {
		if (typeof obj[key] === 'object' && obj[key] !== null) {
			DeepFreeze(obj[key])
		}
	}
	return obj
}