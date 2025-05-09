const { DATABASE_BACKUPS } = require("../Constants");
const Database = require("../Database")
const fs = require("node:fs");
const Log = require("../Logs");

function GetDate() {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

const MAX_BACKUPS = 7; // maximum number of backups to keep

const EXTENSION = 'backup.db'; // extension for the backup files

module.exports = async function BackupDatabase() {

	const backupStart = process.hrtime.bigint();

	// truncate = flush all WAL & set WAL file back to 0 bytes
	Database.exec('PRAGMA wal_checkpoint(TRUNCATE)');

	const date = GetDate();
	const backupFile = `${DATABASE_BACKUPS}/${date}.${EXTENSION}`;

	await Database.backup(backupFile);
	const backupEnd = process.hrtime.bigint();
	const backupDuration = Number(backupEnd - backupStart) / 1e6; // convert to milliseconds
	Log.success(`Database backup created: ${backupFile} (${backupDuration.toFixed(2)} ms)`);

	const purgeStart = process.hrtime.bigint();

	// delete old backups
	const backups = fs.readdirSync(DATABASE_BACKUPS).filter(x => x.endsWith(EXTENSION));
	if (backups.length <= MAX_BACKUPS) return;
	
	backups.sort((a, b) => {
		const aDate = new Date(a.split('.')[0]);
		const bDate = new Date(b.split('.')[0]);
		return aDate - bDate;
	});

	const filesToDelete = backups.slice(0, backups.length - MAX_BACKUPS);
	for (const file of filesToDelete) {
		await fs.promises.unlink(`${DATABASE_BACKUPS}/${file}`);
	}

	const purgeEnd = process.hrtime.bigint();
	const purgeDuration = Number(purgeEnd - purgeStart) / 1e6; // convert to milliseconds
	Log.success(`Deleted ${filesToDelete.length} old backups in ${purgeDuration.toFixed(2)} ms`);
}