export const ROOT_FOLDER     = `${__dirname}/../..`;

export const DB_SETUP_FILE   = `${ROOT_FOLDER}/DB_SETUP.sql`;
export const DB_FILE         = `${ROOT_FOLDER}/fbi.sqlite`;

// If we lose internet we will dump the cache in here and read it back on startup
export const DOWNLOAD_CACHE_PATH  = `${ROOT_FOLDER}/DownloadCache`;
export const UPLOAD_CACHE_PATH    = `${ROOT_FOLDER}/UploadCache`;
export const FAILED_MESSAGES = `${ROOT_FOLDER}/FailedMessages`;

export const SECONDS = {
	MINUTE : 60,
	HOUR   : 60 * 60,
	DAY    : 60 * 60 * 24,
	WEEK   : 60 * 60 * 24 * 7,
	/** 30 days */
	MONTH  : 60 * 60 * 24 * 30,
	/** 365 days */
	YEAR   : 60 * 60 * 24 * 365
} as const;

export const COLOR = {
	PRIMARY   : 0xff9900,
	SECONDARY : 0x202026,
	TERTIARY  : 0x2c2f33,
	HIGHLIGHT : 0x007799,

	ERROR     : 0xff0000,
	SUCCESS   : 0x00ff00,
} as const;

export const FORMAT = {
	TEXT : 1,
	JSON : 2,
	HTML : 4,

	/**
	 * @deprecated This format is no longer available and will error if attempted
	 */
	CSV  : 3,
} as const;

export const FORMAT_NAMES: { [K in keyof typeof FORMAT as (typeof FORMAT)[K]]: string } = {
	[FORMAT.TEXT] : 'TXT',
	[FORMAT.JSON] : 'JSON',
	[FORMAT.HTML] : 'HTML',

	/**
	 * @deprecated This format is no longer available and will error if attempted
	 */
	[FORMAT.CSV] : 'CSV'
} as const;

export const FORMAT_EMOJIS: { [K in keyof typeof FORMAT as (typeof FORMAT)[K]]: string } = {
	[FORMAT.TEXT] : '📄',
	[FORMAT.JSON] : '🗂️',
	[FORMAT.HTML] : '🌐',

	/**
	 * @deprecated This format is no longer available and will error if attempted
	 */
	[FORMAT.CSV] : '📊'
} as const;

export const SNAPSHOT_TYPE = {
	AUTOMATIC : 0,
	MANUAL    : 1,
	IMPORT    : 2
} as const;

export const SNAPSHOT_TYPE_NAME: { [K in keyof typeof SNAPSHOT_TYPE as (typeof SNAPSHOT_TYPE)[K]]: string } = {
	[ SNAPSHOT_TYPE.AUTOMATIC ]: 'AUTOMATIC',
	[ SNAPSHOT_TYPE.MANUAL ]: 'MANUAL',
	[ SNAPSHOT_TYPE.IMPORT ]: 'IMPORT',
} as const;

export const SNAPSHOT_TYPE_EMOJI = {
	[ SNAPSHOT_TYPE.MANUAL    ] : '🔧',
	[ SNAPSHOT_TYPE.AUTOMATIC ] : '⏰',
	[ SNAPSHOT_TYPE.IMPORT    ] : '📥'
} as const;

export const EMOJI = {
	BOT           : '<:bot:1379521311684165653>',
	LOADING       : '<a:loading:1375384157152084088>',
	ERROR         : '❌',
	SUCCESS       : '✅',
	INFO          : 'ℹ️',
	WARNING       : '🚩',
	SEARCH        : '🔍',

	TADA          : '🎉',

	SNAPSHOT      : '📦',
	EXPORT        : '📤',
	IMPORT        : '📥',
	PIN           : '📌',

	FIRST_PAGE    : '⏪',
	PREVIOUS_PAGE : '◀️',
	NEXT_PAGE     : '▶️',
	LAST_PAGE     : '⏩',

	DELETE        : '🗑️',
	EDIT          : '✏️',
	OPEN          : '1382570390861254787',
} as const;

export const LOADING_MESSAGES = [
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
] as const;

export function RandomLoadingMessage() {
	const index = Math.floor(Math.random() * LOADING_MESSAGES.length);
	return LOADING_MESSAGES[index];
}

export function RandomLoadingEmbed() {
	return {
		color: COLOR.PRIMARY,
		description: EMOJI.LOADING + ' ' + RandomLoadingMessage()
	}
}

export const RESTORE_OPTIONS = {
	CHANNELS : 1,
	ROLES    : 2,
	BANS     : 3,
} as const;

export const RESTORE_OPTION_NAMES: { [K in keyof typeof RESTORE_OPTIONS as (typeof RESTORE_OPTIONS)[K]]: string } = {
	[RESTORE_OPTIONS.CHANNELS] : '📁 Channels',
	[RESTORE_OPTIONS.ROLES   ] : '👥 Roles',
	[RESTORE_OPTIONS.BANS    ] : '🚫 Bans'
} as const;

export const DIFF_CHANGE_TYPE = {
	CREATE: 0,
	UPDATE: 1,
	DELETE: 2
} as const;