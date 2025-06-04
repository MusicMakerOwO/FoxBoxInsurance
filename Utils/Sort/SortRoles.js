module.exports = function SortRoles(roles, property) {
	const sorted = Array.from(roles).sort((r1, r2) => {
		if (property) {
			r1 = r1[property];
			r2 = r2[property];
		}

		// Primary sort: raw position
		if (r1.position !== r2.position) return r2.position - r1.position;

		// Tiebreaker: snowflake ID
		return BigInt(r1.id) < BigInt(r2.id) ? -1 : 1;
	});

	return sorted;
}
