const client = require('../../client.js');
const TTLCache = require('../Caching/TTLCache.js');
const { SECONDS } = require('../Constants');
const https = require('node:https');

// jobID -> { status: 'pending' | 'in-progress' | 'completed' | 'failed', progress: 0-100, errors: string[] }
// Delete after 60 minutes of inactivity
const JOBS = new TTLCache();

const ACTIVE_RESTORE_GUILDS = new Set(); // guildID[] - to prevent multiple restore jobs running in the same guild at the same time

const API_TYPES = {
	ROLE_CREATE: 'role-create',
	ROLE_UPDATE: 'role-update',
	ROLE_DELETE: 'role-delete',
	CHANNEL_CREATE: 'channel-create',
	CHANNEL_UPDATE: 'channel-update',
	CHANNEL_DELETE: 'channel-delete',
	BAN_CREATE: 'ban-create',
	BAN_DELETE: 'ban-delete'
}
const API_TYPES_SET = new Set(Object.values(API_TYPES));

const ACTION_ENDPOINTS = {
	[ API_TYPES.ROLE_CREATE ]: ['POST', '/guilds/{guildID}/roles'],
	[ API_TYPES.ROLE_UPDATE ]: ['PATCH', '/guilds/{guildID}/roles/{id}'],
	[ API_TYPES.ROLE_DELETE ]: ['DELETE', '/guilds/{guildID}/roles/{id}'],

	[ API_TYPES.CHANNEL_CREATE ]: ['POST', '/guilds/{guildID}/channels'],
	[ API_TYPES.CHANNEL_UPDATE ]: ['PATCH', '/channels/{id}'],
	[ API_TYPES.CHANNEL_DELETE ]: ['DELETE', '/channels/{id}'],

	[ API_TYPES.BAN_CREATE ]: ['PUT', '/guilds/{guildID}/bans/{id}'],
	[ API_TYPES.BAN_DELETE ]: ['DELETE', '/guilds/{guildID}/bans/{id}']
}

const ENDPOINTS_WITH_BODY = new Set([
	API_TYPES.ROLE_CREATE,
	API_TYPES.ROLE_UPDATE,
	API_TYPES.CHANNEL_CREATE,
	API_TYPES.CHANNEL_UPDATE
]);

const STATUS = {
	RUNNING: 'running',
	COMPLETED: 'completed',
	FAILED: 'failed',
	ABORTED: 'aborted'
}

let JOB_LIST = [];

let JOB_ID_COUNTER = 0;
function CreateJob(data) {

	if (ACTIVE_RESTORE_GUILDS.has(data.guildID)) {
		throw new Error(`A restore job is already running for guild ${data.guildID}`);
	}

	const ID = JOB_ID_COUNTER++;
	const job = {
		id: ID,
		snapshotID: data.snapshotID ?? null,
		guildID: data.guildID ?? null,
		ownerID: data.ownerID ?? null,
		botRoleID: data.botRoleID ?? null,
		actions: data.actions ?? null,
		cursor: 0,
		status: STATUS.RUNNING,
		channel_lookups: new Map(), // old-channel-id -> new-channel-id
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
		if (!API_TYPES_SET.has(action.type)) {
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
	ACTIVE_RESTORE_GUILDS.add(data.guildID);
	JOBS.set(ID, job, SECONDS.HOUR * 1000); // Store job for 1 hour
	JOB_LIST.push(job);
	if (!restoreRunning) {
		restoreRunning = true;
		RestoreJob();
	}
	return ID;
}

function isGuildRestoring(guildID) {
	if (typeof guildID !== 'string') throw new Error('Guild ID must be a string');
	return ACTIVE_RESTORE_GUILDS.has(guildID);
}

function GetJob(jobID) {
	if (typeof jobID !== 'number') throw new Error('Job ID must be a number');

	const job = JOBS.get(jobID);
	if (!job) return null;

	return job;
}

function CancelJob(jobID) {
	if (typeof jobID !== 'number') throw new Error('Job ID must be a number');

	const job = JOBS.get(jobID);
	if (!job) return false; // Job not found
	if (job.status !== STATUS.RUNNING) return false; // No need to cancel if not running

	job.status = STATUS.ABORTED;
	ACTIVE_RESTORE_GUILDS.delete(job.guildID);

	JOBS.set(job.id, job, SECONDS.HOUR * 1000);
	DeleteFromQueue(job.id);
	return true;
}

function DeleteFromQueue(jobID) {
	if (typeof jobID !== 'number') throw new Error('Job ID must be a number');

	JOB_LIST = JOB_LIST.filter(job => job.id !== jobID);
	JOBS.delete(jobID);

	return true;
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

		await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate processing delay

		const { job, action } = result;
		try {
			await executeAction(job, action);
		} catch (err) {
			job.status = STATUS.FAILED;
			job.errors.push(err.message);
			JOBS.set(job.id, job, SECONDS.HOUR * 1000);
		}
	}

	// reset state before exit
	index = 0;
	JOB_LIST = JOB_LIST.filter(job => job.status === STATUS.RUNNING);

	restoreRunning = JOB_LIST.length > 0; // If there are still jobs to process, keep running

	if (JOB_LIST.length > 0) {
		// If there are still jobs to process, continue restoring
		setImmediate(RestoreJob);
	}
}

let rateLimitUntil = 0;
function executeAction(job, action) {
	return new Promise( async (resolve, reject) => {
		const timeRemainingRateLimit = rateLimitUntil - Date.now();
		if (timeRemainingRateLimit > 0) {
			await new Promise(r => setTimeout(r, timeRemainingRateLimit + 250)); // wait until rate limit expires + 1/4 second buffer
		}

		const callback = ACTION_ENDPOINTS[action.type];
		if (!callback) {
			reject(new Error(`Invalid action type: ${action.type}`));
			return;
		}

		if (action.type === API_TYPES.CHANNEL_CREATE) {
			const guild = client.guilds.cache.get(job.guildID);
			if (!guild) reject(new Error(`Guild with ID ${job.guildID} not found`));

			if (action.data.parent_id && job.channel_lookups.has(action.data.parent_id)) {
				action.data.parent_id = job.channel_lookups.get(action.data.parent_id);
			}

			console.log(action);

			const channel = await guild.channels.create({
				... action.data,
				parent: action.data.parent_id
			});

			job.channel_lookups.set(action.data.id, channel.id);

			const index = JOB_LIST.findIndex(j => j.id === job.id);
			if (index !== -1) JOB_LIST[index] = job; // Update the job in the list
			JOBS.set(job.id, job, SECONDS.HOUR * 1000); // Update the job in the cache

			resolve();
			return;
		}

		const [ method, endpoint ] = callback;
		const url = endpoint.replace('{guildID}', job.guildID)
			.replace('{id}', action.data.id ?? action.data.user_id);

		const requiresBody = ENDPOINTS_WITH_BODY.has(action.type);
		const requestData = requiresBody ? JSON.stringify(action.data) : null;

		await SendRequest(method, url, requestData);

		resolve();
	})
}

function SendRequest (method, endpoint, data) {
	return new Promise((resolve, reject) => {
		const request = https.request(`https://discord.com/api/v10${endpoint}`, {
			method: method,
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bot ${client.config.TOKEN}`
			}
		}, (res) => {
			const responseData = [];
			res.on('data', (chunk) => responseData.push(chunk));
			res.on('end', () => {
				const response = Buffer.concat(responseData).toString();
				if (res.statusCode >= 200 && res.statusCode < 300) {
					try {
						var parsedResponse = JSON.parse(response);
					} catch (e) {
						var parsedResponse = response;
					}
					resolve(parsedResponse);
				} else {
					reject(new Error(`HTTP ${res.statusCode}: ${response}`));
				}
			});
		});

		function closeRequest(reason) {
			if (request.writable) {
				request.end();
			}
			request.removeAllListeners();
			request.destroy();
			reject(new Error(`Request closed: ${reason}`));
		}

		request.on('error', (err) => {
			closeRequest(`Error: ${err.message}`);
		});
		request.on('timeout', () => {
			closeRequest('Timed out');
		});

		if (data) {
			request.write(data);
		}

		request.end();
	});
}

module.exports = {
	API_TYPES,
	STATUS,

	CreateJob,
	GetJob,
	CancelJob,
	isGuildRestoring,
	
	JOBS,
	rateLimitUntil
};