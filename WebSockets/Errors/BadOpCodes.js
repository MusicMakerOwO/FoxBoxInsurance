const { WebSocketOpCodes } = require('../../Utils/Constants');
const Log  = require('../../Utils/Logs');

module.exports = {
	op_code: WebSocketOpCodes.ERR_BAD_OP_CODES,
	handler: async function (message) {
		Log.error(`[WEBSOCKET] One or more of your op codes are out of sync with the API. Please update your op codes in Utils/Constants`);
		process.exit(1);
	}
}