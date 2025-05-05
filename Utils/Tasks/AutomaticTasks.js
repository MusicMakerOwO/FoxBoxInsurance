const { SECONDS } = require("../Constants");
const Database = require("../Database");
const { warn, error, success } = require("../Logs");
const TaskScheduler = require("../TaskScheduler");

const TIME_BETWEEN_TASKS = SECONDS.MINUTE * 5; // 5 minutes

const TASK = {
	CLEAN_DATABASE: 'clean_database',
	CHANNEL_PURGE: 'channel_purge',
	UPLOAD_FILES: 'upload_files',
	ENCRYPT_MESSAGES: 'encrypt_messages',
	UPLOAD_STATS: 'upload_stats',
}

const TaskFunctions = {
	[ TASK.CHANNEL_PURGE 	]: require("./ChannelPurge"),
	[ TASK.CLEAN_DATABASE	]: require("./CleanDatabase"),
	[ TASK.UPLOAD_FILES		]: require("./UploadFiles"),
	[ TASK.ENCRYPT_MESSAGES	]: require("./EncryptMessages"),
	[ TASK.UPLOAD_STATS		]: require("./PushStats"),
}

const TASK_INTERVAL = {
	[TASK.CLEAN_DATABASE]: SECONDS.WEEK,
	[TASK.CHANNEL_PURGE]: SECONDS.WEEK,
	[TASK.UPLOAD_FILES]: SECONDS.HOUR,
	[TASK.ENCRYPT_MESSAGES]: SECONDS.HOUR * 2,
	[TASK.UPLOAD_STATS]: SECONDS.HOUR,
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

	TASK_INTERVAL[task] *= 1000; // convert to milliseconds
}

module.exports.StartTasks = function StartTasks() {
	const totalTasks = Object.keys(TaskFunctions).length;
	if (totalTasks === 0) {
		warn("No tasks to manage - nothing to do!");
		return;
	} else {
		success(`Starting ${totalTasks} automatic tasks...`);
	}

	const QueuedTasks = []; // {name, callback, last_run}

	for (const [name, callback] of Object.entries(TaskFunctions)) {
		const interval = TASK_INTERVAL[name];
		if (interval === undefined) {
			warn(`Task "${name}" does not have a defined interval, skipping...`);
			continue;
		}

		const lastRun = Database.prepare("SELECT last_run FROM Timers WHERE id = ?").pluck().get(name) || 0;

		QueuedTasks.push({ name, callback, last_run: lastRun });
	}

	// Sort the tasks, newer tasks first
	QueuedTasks.sort((a, b) => b.last_run - a.last_run);

	for (let i = 0; i < QueuedTasks.length; i++) {
		const task = QueuedTasks[i];
		const interval = TASK_INTERVAL[task.name];

		// minimum time between tasks
		const lastTask = QueuedTasks[i - 1];
		const delay = lastTask ? Math.max(0, lastTask.last_run + TIME_BETWEEN_TASKS - task.last_run) * 1000 : 0;

		const now = Date.now();
		const timeSinceLastRun = Math.max(0, now - task.last_run);

		TaskScheduler.schedule(() => {
			try {
				task.callback();
				Database.prepare("INSERT OR REPLACE INTO Timers (id, last_run) VALUES (?, ?)").run(task.name, Date.now());
			} catch (err) {
				error(err);
			}
		}, 
			(timeSinceLastRun >= interval ? 0 : interval - timeSinceLastRun) + (delay * 1000), // delay until next run
			interval // repeat interval
		);
	}
}