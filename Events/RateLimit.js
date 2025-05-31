const { SECONDS } = require('../Utils/Constants');
const RestoreJob = require('../Utils/Parsers/RestoreJobs.js');
const Log = require('../Utils/Logs.js');

module.exports = {
	name: 'rateLimited',
	execute: function(client, ratelimit) {
		const cooldown = ratelimit.retryAfter + 0; // Add 0 to break reference
		if (isNaN(cooldown) || cooldown <= 0) {
			Log.error(`[RATELIMIT] Invalid rate limit cooldown: ${cooldown}. Defaulting to 60 seconds.`);
			RestoreJob.rateLimitUntil = Date.now() + (SECONDS.MINUTE * 1000); // Default to 60 seconds
			return;
		}

		RestoreJob.rateLimitUntil = Date.now() + cooldown;
		Log.error(`[RATELIMIT] Rate limit until: ${new Date(RestoreJob.rateLimitUntil).toLocaleString()}. Cooldown: ${cooldown}ms`);
	}
}