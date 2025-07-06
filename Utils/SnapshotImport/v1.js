const Database = require("../Database");
const crypto = require("node:crypto");
const { SimplifyChannel, SimplifyRole, SimplifyBan, SimplifyPermission } = require("../SnapshotUtils");
const { SNAPSHOT_ERRORS } = require("./errors");

module.exports = function ParseV1(metadata, snapshotData) {
	// make sure there are no additional fields
	const requiredFields = new Set(['id', 'version', 'channels', 'roles', 'permissions', 'bans']);
	const includedFields = new Set(Object.keys(snapshotData));
	for (const field of includedFields) {
		if (!requiredFields.has(field)) {
			console.log(`Snapshot data contains unexpected field: ${field}`);
			throw SNAPSHOT_ERRORS.UNEXPECTED_FIELD;
		}
	}
	for (const field of requiredFields) {
		if (!includedFields.has(field)) {
			console.log(`Snapshot data is missing required field: ${field}`);
			throw SNAPSHOT_ERRORS.UNEXPECTED_FIELD;
		}
	}

	const Parse = (entry, simplify) => {
		if (!(entry in snapshotData) || !Array.isArray(snapshotData[entry])) {
			throw SNAPSHOT_ERRORS.UNEXPECTED_FIELD;
		}

		for (let i = 0; i < snapshotData[entry].length; i++) {
			if (typeof snapshotData[entry][i] !== 'object' || !snapshotData[entry][i]) {
				console.log(`Snapshot data for ${entry} at index ${i} is not a valid object`);
				throw SNAPSHOT_ERRORS.CORRUPTED;
			}
			snapshotData[entry][i] = simplify(snapshotData[entry][i]);
		}
	}

	Parse('channels', SimplifyChannel);
	Parse('roles', SimplifyRole);
	Parse('permissions', (p) => SimplifyPermission(p.channel_id, p));
	Parse('bans', SimplifyBan);
}