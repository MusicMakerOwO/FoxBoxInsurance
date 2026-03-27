export const SNAPSHOT_ERRORS = {
	MISMATCH_FIELDS: "Snapshot either has missing or unexpected data",
	BAD_DATA_TYPE: "Snapshot has unexpected data and importing has been aborted",
	CORRUPTED: 'Snapshot data is corrupted or tampered'
} as const;