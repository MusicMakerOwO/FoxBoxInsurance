const ReadFolder = require('./ReadFolder');
const { existsSync } = require('node:fs');

module.exports = function WebSocketLoader(folder, cache) {
	if (typeof folder !== 'string') throw new TypeError(`Folder must be a string - Received ${typeof folder}`);

	if (!existsSync(folder)) {
		throw new Error(`No "${folder}" folder found`);
	}

	const filePaths = ReadFolder(folder);
	for (let i = 0; i < filePaths.length; i++) {
		if (!filePaths[i].endsWith('.js')) continue;

		try {
			const data = require(filePaths[i]);

			if (!data.handler) throw `No execute function found`;
			if (typeof data.handler !== 'function') throw `Execute is not a function`;

			if (typeof data.op_code !== 'number' || data.op_code < 0 || isNaN(data.op_code)) throw 'Invalid op_code type - Must be a positive integer';

			if (cache.has(data.op_code)) throw `Duplicate op_code ${data.op_code} found in ${filePaths[i]}`;

			cache.set(data.op_code, data);
		} catch (error) {
			console.error(`[${folder.toUpperCase()}] Failed to load ${filePaths[i]}:`, error);
		}

	}
};