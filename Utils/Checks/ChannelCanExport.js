const Task = require('../TaskScheduler');
const Database = require('../Database');
const { SECONDS } = require('../Constants');

const GetBlacklistChannels = Database.prepare('SELECT id FROM Channels WHERE block_exports = 1');

// Using a Set because lookup is O(1) and prevents duplicates
// Arrays have O(n) lookup and can have duplicates, generally slower for large datasets
const BlacklistedChannels = new Set(); // string[]

RefreshChannels();

// const ShouldSaveMessage = require(...)
module.exports = function ShouldSaveMessage(channelID) {
	const result = !BlacklistedChannels.has(channelID);
	console.log(`Channel ${channelID} is ${result ? 'not' : ''} blacklisted`);
	return result;
}

module.exports.BlacklistedChannels = BlacklistedChannels;
module.exports.RefreshChannels = RefreshChannels;

function RefreshChannels () {
	// Load the blacklisted channels from the database
	BlacklistedChannels.clear();
	BlacklistedChannels.add(...GetBlacklistChannels.pluck().all());
}

Task.schedule(RefreshChannels, SECONDS.HOUR); // refresh every hour