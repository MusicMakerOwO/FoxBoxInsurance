const { WebSocketOpCodes } = require('../Utils/Constants');
const HashObject = require('../Utils/HashObject');

module.exports = {
	op_code: WebSocketOpCodes.HELLO,
	handler: async function (message) {
		if (!process.env.WEBSOCKET_AUTH) throw new Error('WEBSOCKET_AUTH environment variable is not set. Cannot identify with WebSocket server.');

		return {
			op: WebSocketOpCodes.IDENTIFY,
			d: {
				auth: process.env.WEBSOCKET_AUTH,
				op_code_hash: HashObject(WebSocketOpCodes)
			}
		}
	}
}