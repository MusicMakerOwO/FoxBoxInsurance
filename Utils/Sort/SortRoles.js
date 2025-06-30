module.exports = function SortRoles(roles, property) {
	const sorted = Array.from(roles).sort((r1, r2) => {
		if (property) {
			r1 = r1[property];
			r2 = r2[property];
		}

		// Primary sort: raw position
		if (r1.position !== r2.position) return r1.position - r2.position;

		// Tiebreaker: snowflake ID
		return BigInt(r1.id) < BigInt(r2.id) ? -1 : 1;
	});

	if (!property) {
		for (let i = 0; i < sorted.length; i++) {
			sorted[i].position = i + 1;
		}
	} else {
		for (let i = 0; i < sorted.length; i++) {
			sorted[i][property].position = i + 1;
		}
	}

	return sorted;
}
