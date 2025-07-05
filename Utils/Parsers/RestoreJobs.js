const client = require('../../client.js');
const TTLCache = require('../Caching/TTLCache.js');
const { SECONDS } = require('../Constants');
const Log = require('../Logs.js');
const { inspect } = require('node:util');

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
	BAN_DELETE: 'ban-delete',
	ROLE_ORDER: 'role-order'
}
const API_TYPES_SET = new Set(Object.values(API_TYPES));

const STATUS = {
	RUNNING: 'running',
	COMPLETED: 'completed',
	FAILED: 'failed',
	ABORTED: 'aborted',
	WAITING: 'waiting' // Hit the rate limit lol
}

let JOB_ID_COUNTER = 0;
function CreateJob(data) {

	if (ACTIVE_RESTORE_GUILDS.has(data.guildID)) {
		throw new Error(`A restore job is already running for guild ${data.guildID}`);
	}

	const ID = JOB_ID_COUNTER++;
	const job = {
		id: ID,
		snapshotID: data.snapshotID ?? null,
		snapshot_type: data.snapshot_type ?? null,
		guildID: data.guildID ?? null,
		ownerID: data.ownerID ?? null,
		botRoleID: data.botRoleID ?? null,
		actions: data.actions ?? null,
		cursor: 0,
		status: STATUS.RUNNING,
		channel_lookups: new Map(), // old-id -> new-id
		role_lookups: new Map(),
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
	if (!restoreRunning) {
		restoreRunning = true;
		RestoreJob();
	}
	return ID;
}

function setRateLimit(delay) {
	if (typeof delay !== 'number' || delay < 0) {
		throw new Error('Rate limit delay must be a non-negative number');
	}
	rateLimitUntil = Date.now() + delay;
	Log.error(`[RATELIMIT] Rate limit until: ${new Date(rateLimitUntil).toLocaleString()} (Cooldown: ${delay}ms)`);
}

function isRateLimited() {
	return rateLimitUntil > Date.now();
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

	return true;
}

let index = 0;
function FetchNextAction() {
	const JobList = Array.from(JOBS.values()).filter(job => job.status === STATUS.RUNNING);

	if (index >= JobList.length) index = 0;
	const targetJob = JobList[index++];
	if (!targetJob) return null;

	const job = JOBS.get(targetJob.id);

	const action = job.actions[job.cursor++];
	if (!action) {
		job.status = (job.cursor >= job.actions.length) ? STATUS.COMPLETED : STATUS.FAILED;

		UpdateJobCache(job);

		ACTIVE_RESTORE_GUILDS.delete(job.guildID);
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
			// fail foward as best as possible
			job.errors.push(err.message);
			JOBS.set(job.id, job, SECONDS.HOUR * 1000);
		}
	}

	index = 0;
	restoreRunning = Array.from(JOBS.values()).some(job => job.status === STATUS.RUNNING);

	if (restoreRunning) setImmediate(RestoreJob);
}

function UpdateJobCache(job) {
	JOBS.set(job.id, job, SECONDS.HOUR * 1000);
}

function HandleDiscordError(err, context) {
	switch (err.code) {
		case 50013: throw new Error(`Missing permissions to ${context}`);
		case 50001: throw new Error(`Missing access to the guild for ${context}`);
		case 10026: throw new Error(`User not found for ${context}`);
		case 50074: throw new Error(`Cannot ${context} required for community server`);
		default:
			console.log( inspect(err.rawError ?? err, { depth: 5, colors: true }) );
			throw new Error(`Failed to ${context}`);
	}
}

let rateLimitUntil = 0;
async function executeAction(job, action) {
	const now = Date.now();
	if (rateLimitUntil > now) {
		job.status = STATUS.WAITING;
		UpdateJobCache(job);

		await new Promise(r => setTimeout(r, rateLimitUntil - now + 250)); // wait for rate limit to expire + 1/4 second buffer
		rateLimitUntil = 0;
		
		job.status = STATUS.RUNNING;
		UpdateJobCache(job);
	}

	const guild = client.guilds.cache.get(job.guildID);
	if (!guild) throw new Error(`Guild with ID ${job.guildID} not found`);

	if (action.data.parent_id && job.channel_lookups.has(action.data.parent_id)) {
		action.data.parent_id = job.channel_lookups.get(action.data.parent_id);
	}

	switch (action.type) {
		case API_TYPES.CHANNEL_CREATE: {
			const channel = await guild.channels.create({
				... action.data,
				parent: action.data.parent_id
			}).catch(err => {
				HandleDiscordError(err, `create channel #${action.data.name} (${action.data.id})`);
			});

			job.channel_lookups.set(action.data.id, channel.id);

			UpdateJobCache(job);
			break;
		}
		case API_TYPES.CHANNEL_UPDATE: {
			const channel = guild.channels.cache.get(action.data.id);
			if (!channel) throw new Error(`Channel with ID ${action.data.id} not found in guild ${job.guildID}`);

			await channel.edit({
				... action.data,
				parent: action.data.parent_id
			}).catch(err => {
				HandleDiscordError(err, `update channel #${channel.name} (${action.data.id})`);
			});
			break;
		}
		case API_TYPES.CHANNEL_DELETE: {
			const channel = guild.channels.cache.get(action.data.id);
			if (!channel) throw new Error(`Channel with ID ${action.data.id} not found in guild ${job.guildID}`);

			await channel.delete().catch(err => {
				HandleDiscordError(err, `delete channel #${channel.name} (${action.data.id})`);
			});
			break;
		}
		case API_TYPES.ROLE_CREATE: {
			if (action.data.id === job.botRoleID) {
				// already exists, can't have two bot roles
				return resolve();
			}

			const role = await guild.roles.create({
				... action.data,
				permissions: action.data.permissions ?? 0n
			}).catch(err => {
				HandleDiscordError(err, `create role @${action.data.name} (${action.data.id})`);
			});

			job.role_lookups.set(action.data.id, role.id);

			UpdateJobCache(job);
			break;
		}
		case API_TYPES.ROLE_UPDATE: {
			if (action.data.id === job.botRoleID) {
				if (action.data.position !== 0) {
					throw new Error(`Bot role position must be 0 or else it will bring permissions issues`);
				}
				// already exists, can't have two bot roles
				return resolve();
			}

			const role = guild.roles.cache.get(action.data.id);
			if (!role) throw new Error(`Role with ID ${action.data.id} not found in guild ${job.guildID}`);

			await role.edit({
				... action.data,
				permissions: action.data.permissions ?? 0n
			}).catch(err => {
				HandleDiscordError(err, `update role @${role.name} (${action.data.id})`);
			});
			break;
		}
		case API_TYPES.ROLE_DELETE: {
			const role = guild.roles.cache.get(action.data.id);
			if (!role) throw new Error(`Role with ID ${action.data.id} not found in guild ${job.guildID}`);

			if (role.id === job.botRoleID) {
				throw new Error(`Cannot delete the bot role (${role.id})`);
			}

			if (role.id === job.guildID) {
				throw new Error(`Cannot delete the @everyone role (${role.id})`);
			}

			await role.delete().catch(err => {
				HandleDiscordError(err, `delete role @${role.name} (${action.data.id})`);
			});
			break;
		}
		case API_TYPES.BAN_CREATE: {
			await guild.bans.create(
				action.data.id ?? action.data.user_id,
				{
					reason: action.data.reason ?? 'No reason provided',
					deleteMessageSeconds: 0
				}
			).catch(err => {
				HandleDiscordError(err, `ban user with ID ${action.data.id ?? action.data.user_id}`);
			});
			break;
		}
		case API_TYPES.BAN_DELETE: {
			await guild.bans.remove(action.data.id ?? action.data.user_id).catch(err => {
				HandleDiscordError(err, `unban user with ID ${action.data.id ?? action.data.user_id}`);
			});
			break;
		}
		case API_TYPES.ROLE_ORDER: {
			if (!Array.isArray(action.data)) {
				throw new Error(`Role order action data must be an array of { id, position }`);
			}
			for (let i = 0; i < action.data.length; i++) {
				if (typeof action.data[i].id !== 'string') {
					throw new Error(`Role order action data at index ${i} must have a string 'id' property`);
				}
				if (typeof action.data[i].position !== 'number') {
					throw new Error(`Role order action data at index ${i} must have a number 'position' property`);
				}
				if (action.data[i].position < 0) {
					throw new Error(`Role position at index ${i} must be a non-negative number`);
				}
				if (action.data[i].id === job.botRoleID && action.data[i].position !== action.data.length) {
					action.data[i].position = action.data.length; // bot role should always be at the top
				}
				action.data[i].role = action.data[i].id; // for backwards compatibility
			}
			await guild.roles.setPositions(action.data).catch(err => {
				HandleDiscordError(err, `set role positions in guild ${job.guildID}`);
			});
			break;
		}
		default: throw new Error(`Unknown action type: ${action.type}`);
	}
}

module.exports = {
	API_TYPES,
	STATUS,

	CreateJob,
	GetJob,
	CancelJob,
	isGuildRestoring,

	setRateLimit,
	isRateLimited,
	
	JOBS,
};