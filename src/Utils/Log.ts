import {inspect} from 'node:util';

const COLOR = {
	RED: '\x1b[31m',
	GREEN: '\x1b[32m',
	YELLOW: '\x1b[33m',
	BLUE: '\x1b[34m',
	MAGENTA: '\x1b[35m',
	CYAN: '\x1b[36m',
	WHITE: '\x1b[37m',
	RESET: '\x1b[0m',
	BRIGHT: '\x1b[1m',
	DIM: '\x1b[2m'
}

const LOG_TYPE = {
	INFO: 'INFO',
	WARN: 'WARN',
	ERROR: 'ERROR',
	DEBUG: 'DEBUG',
	TRACE: 'TRACE',
}

const LOG_COLOR = {
	[LOG_TYPE.INFO]: COLOR.CYAN,
	[LOG_TYPE.WARN]: COLOR.YELLOW,
	[LOG_TYPE.ERROR]: COLOR.RED + COLOR.BRIGHT,
	[LOG_TYPE.DEBUG]: COLOR.GREEN,
	[LOG_TYPE.TRACE]: COLOR.BLUE,
}

// Just so we can make the logs look pretty and aligned
const LONGEST_LOG_TYPE = Math.max(...Object.keys(LOG_TYPE).map((type) => type.length));

function GetTimestamp() {
	const date = new Date();
	const year = date.getFullYear().toString().padStart(4, '0');
	const month = (date.getMonth() + 1).toString().padStart(2, '0');
	const day = date.getDate().toString().padStart(2, '0');
	const hours = date.getHours().toString().padStart(2, '0');
	const minutes = date.getMinutes().toString().padStart(2, '0');
	const seconds = date.getSeconds().toString().padStart(2, '0');
	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function Log(type: keyof typeof LOG_TYPE, ... messages: unknown[]) {
	if (!LOG_TYPE[type]) {
		console.error(`${COLOR.RED}Invalid log type: ${type}. Valid types are: ${Object.keys(LOG_TYPE).join(', ')}${COLOR.RESET}`);
		return;
	}

	const logType = '[ ' + type.toUpperCase().padEnd(LONGEST_LOG_TYPE, ' ') + ' ]';

	const isError = type === LOG_TYPE.ERROR;
	const timestamp = GetTimestamp();
	const color = LOG_COLOR[type];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (typeof msg !== 'string') messages[i] = inspect(msg, { depth: 3, colors: !isError });
	}

	const messageString = messages.join(' ');

	console.log(`${color}${logType} ${timestamp} : ${!isError ? COLOR.RESET : ''}${messageString}${COLOR.RESET}`);
}

export {
	LOG_TYPE,
	LOG_COLOR,
	COLOR,

	Log,
	GetTimestamp,
}