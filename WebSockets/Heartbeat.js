const { WebSocketOpCodes } = require('../Utils/Constants');

module.exports = {
	op_code: WebSocketOpCodes.HEARTBEAT,
	handler: async function (message) {
		return { op: WebSocketOpCodes.HEARTBEAT_ACK }
	}
}