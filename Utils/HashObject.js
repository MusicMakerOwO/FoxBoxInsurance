const crypto = require('node:crypto');

module.exports = function HashObject(obj) {
	if (Object.values(obj).some(v => typeof v === 'object' && v !== null)) {
		console.log(obj);
		throw new Error('HashObject received a nested object. Use only on flattened structures.');
	}

	const entries = Object.entries(obj);
	entries.sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
	const flatString = entries.map(([key, value]) => key + ':' + value).join(',');
	return crypto.createHash('sha1').update(flatString).digest('hex');
}