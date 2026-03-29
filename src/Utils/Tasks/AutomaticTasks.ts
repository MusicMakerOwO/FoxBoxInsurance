import {SECONDS} from "../Constants";
import {Log} from "../Log";
import {Database} from "../../Database";
import {TaskScheduler} from "../TaskScheduler";
import {SnapshotServers} from "./SnapshotServers";
import {PushStats} from "./PushStats";
import {ChannelPurge} from "./ChannelPurge";

const TIME_BETWEEN_TASKS = SECONDS.MINUTE * 10; // 10 minutes

const TASKS: [name: string, callback: () => Promise<void>, interval: number ][] = [
    [ 'server_snapshots'  , SnapshotServers  , SECONDS.HOUR * 1000     ],
    // [ 'upload_files'      , require("./UploadFiles")      , SECONDS.HOUR * 1000     ],
    [ 'upload_stats'      , PushStats        , SECONDS.HOUR * 1000     ],
    // [ 'encrypt_messages'  , require("./EncryptMessages")  , SECONDS.HOUR * 1000 * 2 ],
    [ 'channel_purge'     , ChannelPurge     , SECONDS.WEEK * 1000     ],
] as const;

const LONGEST_NAME_LENGTH = Math.max( ... TASKS.map(t => t[0].length) );

export async function StartAutomaticTasks() {
	if (TASKS.length === 0) {
		Log('WARN', "No tasks to manage - nothing to do!");
		return;
	} else {
		Log('DEBUG', `Starting ${TASKS.length} automatic tasks...`);
	}

	const connection = await Database.getConnection();

	for (let i = 0; i < TASKS.length; i++) {
		const taskData = TASKS[i];
		if (!Array.isArray(taskData) || taskData.length !== 3) {
			Log('WARN', `Task entry ${i} is not an array, skipping...`);
			continue;
		}
		const [ name, callback, interval ] = taskData;

		if (interval <= 0 || !Number.isFinite(interval)) {
			Log('WARN', `Task "${name}" does has an invalid interval, skipping...`);
			continue;
		}
		if (typeof callback !== 'function') {
			Log('WARN', `Task "${name}" does not have a callback function, skipping...`);
			continue;
		}
		if (callback.constructor.name !== 'AsyncFunction') {
			Log('WARN', `Task "${name}" callback must be an async function, skipping...`);
			continue;
		}

		const lastRun = await connection.query("SELECT last_run FROM Timers WHERE id = ?", [name]).then(res => res[0]?.last_run ?? 0) as number;
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
				Log('ERROR', err);
			}
		}, delay, interval);

		Log('DEBUG', `[TASKS] - "${name}"${' '.repeat(LONGEST_NAME_LENGTH - name.length + 2)} : delayed ${(delay / 1000 / 60).toFixed(2)} minutes`);
	}

	Database.releaseConnection(connection);
}