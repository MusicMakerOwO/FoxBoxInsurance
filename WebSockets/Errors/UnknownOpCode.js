const { WebSocketOpCodes } = require('../../Utils/Constants');
const Log  = require('../../Utils/Logs');

module.exports = {
	op_code: WebSocketOpCodes.ERR_UNKNOWN_OP_CODE,
	handler: async function (data) {
		Log.error(`[WEBSOCKET] ${data.message}`);
	}
}