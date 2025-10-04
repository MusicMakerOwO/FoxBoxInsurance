const { WebSocketOpCodes } = require('../../Utils/Constants');
const Log  = require('../../Utils/Logs');

module.exports = {
	op_code: WebSocketOpCodes.ERR_UNKNOWN_OP_CODE,
	handler: async function (message) {
		Log.error(`[WEBSOCKET] Unknown Op Code`);
	}
}