import { SNAPSHOT_TYPE } from "../Constants.js";
import { JSONSnapshot, Snapshot } from "../../CRUD/Snapshots.js";

/**
 * How a snapshot is named to users: `Snapshot #142` for stored snapshots, `Import #xxxx-xxxx-xxxx-xxxx`
 * for staged imports. Imports keep their export ID rather than a number, so the two cannot share a format.
 */
export function SnapshotLabel(snapshot: Snapshot | JSONSnapshot): string {
	return snapshot.type === SNAPSHOT_TYPE.IMPORT ? `Import #${snapshot.id}` : `Snapshot #${snapshot.id}`;
}
