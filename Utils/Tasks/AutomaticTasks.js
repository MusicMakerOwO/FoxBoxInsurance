const { SECONDS } = require("../Constants");
const Database = require("../Database");
const { warn, error, success } = require("../Logs");
const TaskScheduler = require("../TaskScheduler");

const TIME_BETWEEN_TASKS = SECONDS.MINUTE * 10; // 10 minutes

const TASK = {
	SERVER_SNAPSHOT: 'server_snapshot',
	UPLOAD_FILES: 'upload_files',
	UPLOAD_STATS: 'upload_stats',
	ENCRYPT_MESSAGES: 'encrypt_messages',
	PURGE_SNAPSHOTS: 'purge_snapshots',
	CLEAN_DATABASE: 'clean_database',
	CHANNEL_PURGE: 'channel_purge',
}

const TaskFunctions = {
	[ TASK.SERVER_SNAPSHOT	]: require("./SnapshotServers"),
	[ TASK.UPLOAD_FILES		]: require("./UploadFiles"),
	[ TASK.UPLOAD_STATS		]: require("./PushStats"),
	[ TASK.ENCRYPT_MESSAGES	]: require("./EncryptMessages"),
	[ TASK.PURGE_SNAPSHOTS	]: require("./PurgeSnapshots"),
	[ TASK.CLEAN_DATABASE	]: require("./CleanDatabase"),
	[ TASK.CHANNEL_PURGE 	]: require("./ChannelPurge"),
}

const TASK_INTERVAL = {
	[TASK.SERVER_SNAPSHOT]: SECONDS.HOUR,
	[TASK.UPLOAD_FILES]: SECONDS.HOUR,
	[TASK.UPLOAD_STATS]: SECONDS.HOUR,
	[TASK.ENCRYPT_MESSAGES]: SECONDS.HOUR * 2,
	// [TASK.PURGE_SNAPSHOTS]: SECONDS.DAY,
	[TASK.CLEAN_DATABASE]: SECONDS.DAY,
	[TASK.CHANNEL_PURGE]: SECONDS.WEEK,
}

let longestName = 0;

let i = 0;
for (const [name, callback] of Object.entries(TaskFunctions)) {
	i++;
	if (name === undefined) {
		warn(`Task ${i} is undefined, skipping...`);
		delete TaskFunctions[name];
		return;
	}

	if (name.length > longestName) {
		longestName = name.length;
	}

	if (typeof callback !== 'function') {
		warn(`Task "${name}" is not a function, skipping...`);
		delete TaskFunctions[name];
		continue;
	}

	TASK_INTERVAL[name] *= 1000; // convert to milliseconds
}

module.exports.StartTasks = async function StartTasks() {
	const totalTasks = Object.keys(TASK).length;
	if (totalTasks === 0) {
		warn("No tasks to manage - nothing to do!");
		return;
	} else {
		success(`Starting ${totalTasks} automatic tasks...`);
	}

	const connection = await Database.getConnection();

	const selectQuery = await connection.prepare("SELECT last_run FROM Timers WHERE id = ?");

	let i = -1;
	for (const name of Object.values(TASK)) {
		i++;
		const callback = TaskFunctions[name];
		const interval = TASK_INTERVAL[name];
		if (interval === undefined) {
			warn(`Task "${name}" does not have a defined interval, skipping...`);
			continue;
		}
		if (callback === undefined) {
			warn(`Task "${name}" does not have a callback function, skipping...`);
			continue;
		}

		const { last_run } = (await selectQuery.execute(name))[0] ?? { last_run: 0 }; // bigint
		// rounding errors shouldn't be a concern because the exact second doesn't matter
		const lastRunNumber = Number(last_run);

		const now = Date.now();
		const timeSinceLastRun = Math.max(0, now - lastRunNumber);

		const offset = (TIME_BETWEEN_TASKS * 1000) * i;
		const delay = Math.max(timeSinceLastRun >= interval ? 0 : interval - timeSinceLastRun, offset);

		TaskScheduler.schedule(() => {
			try {
				callback();
				connection.query("INSERT INTO Timers (id, last_run) VALUES (?, ?) ON DUPLICATE KEY UPDATE last_run = VALUES(last_run)", [name, Date.now()]);
			} catch (err) {
				error(err);
			}
		}, delay, interval);

		success(`[TASKS] - "${name}"${' '.repeat(longestName - name.length + 2)} : delayed ${(delay / 1000 / 60).toFixed(2)} minutes`);
	}

	Database.releaseConnection(connection);
}