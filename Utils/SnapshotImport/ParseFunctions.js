const ParseFunctions = new Map();

let i = 1;
while (true) {
	try {
		const parseModule = require(`./v${i}`);
		ParseFunctions.set(i, parseModule);
	} catch (error) {
		if (error.code === 'MODULE_NOT_FOUND') {
			break; // No more versions available
		} else {
			throw error;
		}
	}
	i++;
}

module.exports = ParseFunctions;