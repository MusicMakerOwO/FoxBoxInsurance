const TimedMap = require('../Caching/TimedCache.js');
const { SECONDS } = require('../Constants');

// jobID -> { status: 'pending' | 'in-progress' | 'completed' | 'failed', progress: 0-100, errors: string[] }
// Delete after 60 minutes of inactivity
const JOBS = new TimedMap(SECONDS.HOUR * 1000);

const API_TYPES = {
	ROLE_CREATE: 'role-create',
	ROLE_UPDATE: 'role-update',
	ROLE_DELETE: 'role-delete',
	CHANNEL_CREATE: 'channel-create',
	CHANNEL_UPDATE: 'channel-update',
	CHANNEL_DELETE: 'channel-delete',
	BAN_CREATE: 'ban-create',
	BAN_UPDATE: 'ban-update',
	BAN_DELETE: 'ban-delete'
}

const STATUS = {
	RUNNING: 'running',
	COMPLETED: 'completed',
	FAILED: 'failed'
}

const JOB_LIST = [];

let JOB_ID_COUNTER = 0;
function CreateJob(data) {
	const ID = JOB_ID_COUNTER++;
	const job = {
		id: ID,
		guildID: data.guildID ?? null,
		ownerID: data.ownerID ?? null,
		botRoleID: data.botRoleID ?? null,
		actions: data.actions ?? null,
		cursor: 0,
		status: STATUS.RUNNING,
		errors: []
	};
	for (const key in job) {
		if (job[key] === undefined || job[key] === null) {
			throw new Error(`Job property "${key}" is required but not provided.`);
		}
	}
	if (!Array.isArray(job.actions) || job.actions.length === 0) {
		throw new Error('Job actions must be a non-empty array.');
	}
	for (const action of job.actions) {
		if (typeof action !== 'object' || !action.type || !action.data) {
			throw new Error('Each action must be an object with "type" and "data" properties.');
		}
		if (!API_TYPES[action.type]) {
			throw new Error(`Invalid action type: ${action.type}`);
		}
	}
	// getter for status: cursor / actions.length
	Object.defineProperty(job, 'progress', {
		get() {
			if (this.actions.length === 0) return 1;
			return Math.min(1, this.cursor / this.actions.length);
		}
	});
	JOBS.set(ID, job);
	JOB_LIST.push(job);
	if (!restoreRunning) {
		restoreRunning = true;
		RestoreJob();
	}
	return job;
}

function GetJob(jobID) {
	if (typeof jobID !== 'number') throw new Error('Job ID must be a number');

	const job = JOBS.get(jobID);
	if (!job) throw new Error(`Job with ID ${jobID} not found`);

	return job;
}

function DeleteFromQueue(jobID) {
	if (typeof jobID !== 'number') throw new Error('Job ID must be a number');

	const jobIndex = JOB_LIST.findIndex(job => job.id === jobID);
	if (jobIndex === -1) throw new Error(`Job with ID ${jobID} not found in queue`);

	JOB_LIST.splice(jobIndex, 1);
}

let index = 0;
function FetchNextAction() {
	if (index >= JOB_LIST.length) index = 0;
	const job = JOB_LIST[index++];
	if (!job) return null;

	const action = job.actions[job.cursor++];
	if (!action) {
		job.status = (job.cursor >= job.actions.length) ? STATUS.COMPLETED : STATUS.FAILED;
		DeleteFromQueue(job.id);
		return null;
	}

	return { job, action };
}

let restoreRunning = false;
async function RestoreJob() {
	while (true) {
		const result = FetchNextAction();
		if (!result) break; // No more actions to process
		if (result.job.status !== STATUS.RUNNING) continue; // Skip if job is not running

		const { job, action } = result;
		try {
			await executeAction(job, action);
		} catch (err) {
			job.status = STATUS.FAILED;
			job.errors.push(err.message);
			JOBS.set(job.id, job);
		}
	}

	// reset state before exit
	restoreRunning = false;
	index = 0;
	JOB_LIST = JOB_LIST.filter(job => job.status === STATUS.RUNNING);
}

let rateLimitUntil = 0;
function executeAction(job, action) {
	return new Promise( async (resolve, reject) => {
		const timeRemainingRateLimit = rateLimitUntil - Date.now();
		if (timeRemainingRateLimit > 0) {
			await new Promise(r => setTimeout(r, timeRemainingRateLimit + 250)); // wait until rate limit expires + 1/4 second buffer
		}

		// do stuff lol

		resolve();
	})
}

module.exports = {
	API_TYPES,
	STATUS,
	CreateJob,
	GetJob,
	DeleteFromQueue,
	JOBS,
	rateLimitUntil
};