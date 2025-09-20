const { WebSocketOpCodes } = require('../Utils/Constants');

module.exports = {
	op_code: WebSocketOpCodes.HEARTBEAT,
	handler: async function heartbeat(ws, message) {
		return { op: WebSocketOpCodes.HEARTBEAT_ACK }
	}
}