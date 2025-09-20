const ROOT_FOLDER = `${__dirname}/..`;

const DB_SETUP_FILE = `${ROOT_FOLDER}/DB_SETUP.sql`;
const DB_FILE = `${ROOT_FOLDER}/fbi.sqlite`;

// If we lose internet we will dump the cache in here and read it back on startup
const DOWNLOAD_CACHE = `${ROOT_FOLDER}/DownloadCache`;
const UPLOAD_CACHE = `${ROOT_FOLDER}/UploadCache`;
const FAILED_MESSAGES = `${ROOT_FOLDER}/FailedMessages`;

const SECONDS = {
	MINUTE: 60,
	HOUR: 	60 * 60,
	DAY: 	60 * 60 * 24,
	WEEK: 	60 * 60 * 24 * 7,
	MONTH: 	60 * 60 * 24 * 30,
	YEAR: 	60 * 60 * 24 * 365
}

const COLOR = {
	PRIMARY: 0xff9900,
	SECONDARY: 202026,
	TERTIARY: 0x2c2f33,
	HIGHLIGHT: 0x007799,

	ERROR: 0xff0000,
	SUCCESS: 0x00ff00,
}

const FORMAT = {
	TEXT: 'txt',
	JSON: 'json',
	CSV: 'csv',
	HTML: 'html'
}

const SNAPSHOT_TYPE = {
	AUTOMATIC: 0,
	MANUAL: 1,
	IMPORT: 2
}

// Reverse the object so we can use the values as keys
// Allows for human readable names
for (const [k, v] of Object.entries(FORMAT)) {
	FORMAT[v] = k;
}
for (const [k, v] of Object.entries(SNAPSHOT_TYPE)) {
	SNAPSHOT_TYPE[v] = k;
}

const SNAPSHOT_TYPE_EMOJI = {
	[ SNAPSHOT_TYPE.MANUAL ]: '🔧',
	[ SNAPSHOT_TYPE.AUTOMATIC ]: '⏰',
	[ SNAPSHOT_TYPE.IMPORT ]: '📥'
}

const EMOJI = {
	BOT: '<:bot:1379521311684165653>',
	LOADING: '<a:loading:1375384157152084088>',
	ERROR: '❌',
	SUCCESS: '✅',
	INFO: 'ℹ️',
	WARNING: '🚩',
	SEARCH: '🔍',

	TADA: '🎉',

	SNAPSHOT: '📦',
	EXPORT: '📤',
	IMPORT: '📥',
	PIN: '📌',

	FIRST_PAGE: '⏪',
	PREVIOUS_PAGE: '◀️',
	NEXT_PAGE: '▶️',
	LAST_PAGE: '⏩',

	DELETE: '🗑️',
	EDIT: '✏️',
	OPEN: '<:launch:1382570390861254787>',
}

const LOADING_MESSAGES = [
	'Hacking the FBI...',
	'Collecting fingerprints ...',
	'Searching for clues ...',
	'Faking a search warrant ...',
	'Searching the dark web ...',
	'Optimizing the optimizer ...',
	'Routing through 17 proxies ...',
	'Enabling AI ... (please dont panic)',
	'Installing Linux on a toaster ...',
	'Downloading internet ...',
	'Interrogating the database ...',
	'Solving P vs NP ...',
	'Scanning for illegal cat pictures ...',
	'Uploading your secrets ... (oops)',
	'Reading the database a bedtime story ...',
	'Feeding hamsters in the server room ...',
	'Petting the internet for good luck ...',
	'Waiting for a discord outage ...',
	'Asking our lawyers if this is legal ...',
	'Finding the best memes ...',
]

function RandomLoadingMessage() {
	const index = Math.floor(Math.random() * LOADING_MESSAGES.length);
	return LOADING_MESSAGES[index];
}

function RandomLoadingEmbed() {
	return {
		color: COLOR.PRIMARY,
		description: EMOJI.LOADING + ' ' + RandomLoadingMessage()
	}
}

const RESTORE_OPTIONS = {
	CHANNELS: 1 << 0,
	ROLES: 1 << 1,
	BANS: 1 << 2
}

const RESTORE_OPTION_NAMES = {
	[RESTORE_OPTIONS.CHANNELS]: '📁 Channels',
	[RESTORE_OPTIONS.ROLES]: '👥 Roles',
	[RESTORE_OPTIONS.BANS]: '🚫 Bans'
}

const WebSocketOpCodes = {
	// connection ops (100-199)
	HEARTBEAT		: 100,
	HEARTBEAT_ACK	: 101,
	SERVER_ACK		: 102,
	CLIENT_ACK		: 103,

	// dispatch ops (200-299)
	FLUSH_CACHE		: 200,

	// errors (400-499)
	JSON_PARSE_ERROR	: 400,
	JSON_FORMAT_ERROR	: 401,
	UNKNOWN_OP_CODE		: 402,
	NO_RESPONSE			: 403,
}

module.exports = {
	ROOT_FOLDER,

	DB_SETUP_FILE,
	DB_FILE,

	DOWNLOAD_CACHE,
	UPLOAD_CACHE,
	FAILED_MESSAGES,

	SECONDS,
	COLOR,
	FORMAT,
	LOADING_MESSAGES,

	SNAPSHOT_TYPE,
	SNAPSHOT_TYPE_EMOJI,
	EMOJI,

	RESTORE_OPTIONS,
	RESTORE_OPTION_NAMES,

	RandomLoadingMessage,
	RandomLoadingEmbed,

	WebSocketOpCodes
}