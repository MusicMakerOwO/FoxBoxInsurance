const { WebSocketOpCodes } = require('../../Utils/Constants');
const Log  = require('../../Utils/Logs');

module.exports = {
	op_code: WebSocketOpCodes.ERR_JSON_PARSE,
	handler: async function (message) {
		Log.error(`[WEBSOCKET] Invalid JSON: ${JSON.stringify(message)}`);
	}
}