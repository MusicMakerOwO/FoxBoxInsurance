const { WebSocketOpCodes } = require('../../Utils/Constants');
const Log  = require('../../Utils/Logs');

module.exports = {
	op_code: WebSocketOpCodes.ERR_INVALID_AUTH,
	handler: async function (message) {
		Log.error('[WEBSOCKET] Invalid auth token in ENV file');
	}
}