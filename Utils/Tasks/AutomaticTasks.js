const { SECONDS } = require("../Constants");
const Database = require("../Database");
const { warn, error, success } = require("../Logs");
const TaskScheduler = require("../TaskScheduler");

const TIME_BETWEEN_TASKS = SECONDS.MINUTE * 10; // 10 minutes

const TASKS = [
	[ 'server_snapshots',	require("./SnapshotServers"),	SECONDS.HOUR	],
	[ 'upload_files',		require("./UploadFiles"),		SECONDS.HOUR	],
	[ 'upload_stats',		require("./PushStats"),			SECONDS.HOUR	],
	[ 'encrypt_messages',	require("./EncryptMessages"),	SECONDS.HOUR * 2],
	[ 'clean_database',		require("./CleanDatabase"),		SECONDS.DAY		],
	[ 'channel_purge',		require("./ChannelPurge"),		SECONDS.WEEK	],
];

for (let i = 0; i < TASKS.length; i++) {
	TASKS[i][2] *= 1000; // convert interval to milliseconds
}

const longestName = Math.max( ... TASKS.map(t => t[0].length) );

module.exports.StartTasks = async function StartTasks() {
	const totalTasks = TASKS.length;
	if (totalTasks === 0) {
		warn("No tasks to manage - nothing to do!");
		return;
	} else {
		success(`Starting ${totalTasks} automatic tasks...`);
	}

	const connection = await Database.getConnection();

	const selectQuery = await connection.prepare("SELECT last_run FROM Timers WHERE id = ?");

	for (let i = 0; i < TASKS.length; i++) {
		const taskData = TASKS[i];
		if (!Array.isArray(taskData) || taskData.length !== 3) {
			warn(`Task entry ${i} is not an array, skipping...`);
			continue;
		}
		const [ name, callback, interval ] = taskData;

		if (typeof interval !== 'number' || interval <= 0 || !Number.isFinite(interval)) {
			warn(`Task "${name}" does not have a defined interval, skipping...`);
			continue;
		}
		if (typeof callback !== 'function') {
			warn(`Task "${name}" does not have a callback function, skipping...`);
			continue;
		}
		if (callback.constructor.name !== 'AsyncFunction') {
			warn(`Task "${name}" callback must be an async function, skipping...`);
			continue;
		}

		const lastRun = await selectQuery.execute(name).then(res => res[0]?.last_run ?? 0);
		// rounding errors shouldn't be a concern because the exact second doesn't matter
		const lastRunNumber = Number(lastRun);

		const now = Date.now();
		const timeSinceLastRun = Math.max(0, now - lastRunNumber);

		const offset = (TIME_BETWEEN_TASKS * 1000) * i;
		const delay = Math.max(timeSinceLastRun >= interval ? 0 : interval - timeSinceLastRun, offset);

		TaskScheduler.schedule(() => {
			try {
				callback();
				Database.query("INSERT INTO Timers (id, last_run) VALUES (?, ?) ON DUPLICATE KEY UPDATE last_run = VALUES(last_run)", [name, Date.now()]);
			} catch (err) {
				error(err);
			}
		}, delay, interval);

		success(`[TASKS] - "${name}"${' '.repeat(longestName - name.length + 2)} : delayed ${(delay / 1000 / 60).toFixed(2)} minutes`);
	}

	Database.releaseConnection(connection);
}