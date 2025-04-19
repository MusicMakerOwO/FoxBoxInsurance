const { TASK, TASK_INTERVAL } = require("../Constants");
const Database = require("../Database");
const { warn, error, success } = require("../Logs");
const TaskScheduler = require("../TaskScheduler");

const TASK = {
	CLEAN_DATABASE: 'clean_database',
	CHANNEL_PURGE: 'channel_purge',
	UPLOAD_FILES: 'upload_files',
	ENCRYPT_MESSAGES: 'encrypt_messages',
}

const TaskFunctions = {
	[ TASK.CHANNEL_PURGE 	]: require("./ChannelPurge"),
	[ TASK.CLEAN_DATABASE	]: require("./CleanDatabase"),
	[ TASK.UPLOAD_FILES		]: require("./UploadFiles"),
	[ TASK.ENCRYPT_MESSAGES	]: require("./EncryptMessages"),
}

const TASK_INTERVAL = {
	[TASK.CLEAN_DATABASE]: SECONDS.WEEK * 1000,
	[TASK.CHANNEL_PURGE]: SECONDS.WEEK * 1000,
	[TASK.UPLOAD_FILES]: SECONDS.HOUR * 1000,
	[TASK.ENCRYPT_MESSAGES]: SECONDS.HOUR * 1000,
}

let i = 0;
for (const [task, callback] of Object.entries(TaskFunctions)) {
	i++;
	if (task === undefined) {
		warn(`Task ${i} is undefined, skipping...`);
		delete TaskFunctions[task];
		return;
	}

	if (typeof callback !== 'function') {
		warn(`Task "${task}" is not a function, skipping...`);
		delete TaskFunctions[task];
		continue;
	}
}

module.exports.StartTasks = function StartTasks() {
	const totalTasks = Object.keys(TaskFunctions).length;
	if (totalTasks === 0) {
		warn("No tasks to manage - nothing to do!");
		return;
	} else {
		success(`Starting ${totalTasks} automatic tasks...`);
	}
	
	for (const [name, callback] of Object.entries(TaskFunctions)) {
		const interval = TASK_INTERVAL[name];
		if (interval === undefined) {
			warn(`Task "${name}" does not have a defined interval, skipping...`);
			continue;
		}

		const lastRun = Database.prepare("SELECT last_run FROM Timers WHERE id = ?").pluck().get(name) || 0;
		const now = Date.now();
		const timeSinceLastRun = Math.max(0, now - lastRun);

		TaskScheduler.schedule(async () => {
			try {
				await callback();
				Database.prepare("INSERT OR REPLACE INTO Timers (id, last_run) VALUES (?, ?)").run(name, Date.now());
			} catch (err) {
				error(err);
			}
		}, 
			timeSinceLastRun >= interval ? 0 : interval - timeSinceLastRun, // delay until next run
			interval // repeat interval
		);
	}
}