import {SnapshotRole} from "../../Typings/DatabaseTypes";

/** Sorts the given role array and mutates the `position` accordingly */
export function SortRoles(roles: SnapshotRole[]) {
	const sorted = Array.from(roles).sort((r1, r2) => {
		// Primary sort: raw position
		if (r1.position !== r2.position) return r1.position - r2.position;

		// Tiebreaker: snowflake ID
		return BigInt(r1.id) < BigInt(r2.id) ? -1 : 1;
	});

	for (let i = 0; i < sorted.length; i++) {
		sorted[i].position = i;
	}

	return sorted;
}