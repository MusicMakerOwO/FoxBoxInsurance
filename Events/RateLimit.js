const { SECONDS } = require('../Utils/Constants');
const Log = require('../Utils/Logs.js');
const { setRateLimit } = require('../Utils/Parsers/RestoreJobs.js');

module.exports = {
	name: 'rateLimited',
	execute: function(client, ratelimit) {
		setRateLimit(ratelimit.retryAfter);
	}
}