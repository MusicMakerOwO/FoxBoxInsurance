const { SECONDS } = require('../Utils/Constants');
const RestoreJob = require('../Utils/Parsers/RestoreJobs.js');
const Log = require('../Utils/Logs.js');

module.exports = {
	name: 'rateLimited',
	execute: function(client, ratelimit) {
		setRateLimit(ratelimit.retryAfter);
	}
}