const { WebSocketOpCodes } = require('../../Utils/Constants');
const Log  = require('../../Utils/Logs');

module.exports = {
	op_code: WebSocketOpCodes.ERR_JSON_FORMAT,
	handler: async function (data) {
		Log.error(`[WEBSOCKET] JSON Format Error: ${data.message}`);
	}
}