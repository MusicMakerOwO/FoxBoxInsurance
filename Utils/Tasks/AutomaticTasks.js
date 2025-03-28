const { TASK, TASK_INTERVAL } = require("../Constants");
const Database = require("../Database");
const { warn, error, success } = require("../Logs");
const TaskScheduler = require("../TaskScheduler");
const ChannelPurge = require("./ChannelPurge");
const CleanDatabase = require("./CleanDatabase");
const DiskCleanup = require("./DiskCleanup");

const Tasks = {
	[ TASK.CHANNEL_PURGE  ]: ChannelPurge,
	[ TASK.CLEAN_DATABASE ]: CleanDatabase,
	[ TASK.CLEAN_DISK 	  ]: DiskCleanup,
}

let i = 0;
for (const [task, callback] of Object.entries(Tasks)) {
	i++;
	if (task === undefined) {
		warn(`Task ${i} is undefined, skipping...`);
		delete Tasks[task];
		return;
	}

	if (typeof callback !== 'function') {
		warn(`Task "${task}" is not a function, skipping...`);
		delete Tasks[task];
		continue;
	}
}

module.exports.StartTasks = function StartTasks() {
	const totalTasks = Object.keys(Tasks).length;
	if (totalTasks === 0) {
		warn("No tasks to manage - nothing to do!");
		return;
	} else {
		success(`Starting ${totalTasks} automatic tasks...`);
	}
	
	for (const [name, callback] of Object.entries(Tasks)) {
		const interval = TASK_INTERVAL[name];
		if (interval === undefined) {
			warn(`Task "${name}" does not have a defined interval, skipping...`);
			continue;
		}

		const lastRun = Database.prepare("SELECT last_run FROM Timers WHERE id = ?").pluck().get(name) || 0;
		const now = Date.now();
		const timeSinceLastRun = Math.max(0, now - lastRun);

		TaskScheduler.schedule(() => {
			try {
				callback(); // execute the task
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