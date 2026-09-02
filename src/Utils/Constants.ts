import { ObjectValues } from "../Typings/HelperTypes.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ROOT_FOLDER     = `${__dirname}/../..`;

// If we lose internet we will dump the cache in here and read it back on startup
export const DOWNLOAD_CACHE_PATH  = `${ROOT_FOLDER}/DownloadCache`;
export const UPLOAD_CACHE_PATH    = `${ROOT_FOLDER}/UploadCache`;

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
	RESTORE       : '🔄',

	FIRST_PAGE    : '⏪',
	PREVIOUS_PAGE : '◀️',
	NEXT_PAGE     : '▶️',
	LAST_PAGE     : '⏩',

	STOP          : '⏹️',

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

export function RandomLoadingMessage(): typeof LOADING_MESSAGES[number] {
	const index = Math.floor(Math.random() * LOADING_MESSAGES.length);
	return LOADING_MESSAGES[index];
}

export function RandomLoadingEmbed(): { color: ObjectValues<typeof COLOR>, description: string } {
	return {
		color: COLOR.PRIMARY,
		description: EMOJI.LOADING + ' ' + RandomLoadingMessage()
	}
}

export const RESTORE_OPTIONS = {
	CHANNELS : 1 << 0,
	ROLES    : 1 << 1,
	BANS     : 1 << 2,
	/** Not implemented - rendered as a permanently disabled toggle */
	MESSAGES : 1 << 3,
} as const;

export const RESTORE_OPTION_NAMES: { [K in keyof typeof RESTORE_OPTIONS as (typeof RESTORE_OPTIONS)[K]]: string } = {
	[RESTORE_OPTIONS.CHANNELS] : '📁 Channels',
	[RESTORE_OPTIONS.ROLES   ] : '👥 Roles',
	[RESTORE_OPTIONS.BANS    ] : '🚫 Bans',
	[RESTORE_OPTIONS.MESSAGES] : '💬 Messages'
} as const;

export const RESTORE_PRESETS = {
	FULL      : RESTORE_OPTIONS.CHANNELS | RESTORE_OPTIONS.ROLES | RESTORE_OPTIONS.BANS,
	STRUCTURE : RESTORE_OPTIONS.CHANNELS | RESTORE_OPTIONS.ROLES,
	BANS      : RESTORE_OPTIONS.BANS,
	CUSTOM    : 0,
} as const;

/** Lifecycle of a `SnapshotRestores` row */
export const RESTORE_STATUS = {
	RUNNING     : 0,
	COMPLETE    : 1,
	/** Finished, but at least one action failed */
	FAILED      : 2,
	/** An admin pressed Stop - the remaining actions were skipped */
	STOPPED     : 3,
	/** The bot restarted mid-run. Not resumed; reported honestly instead */
	INTERRUPTED : 4,
} as const;

export const RESTORE_STATUS_NAMES: { [K in keyof typeof RESTORE_STATUS as (typeof RESTORE_STATUS)[K]]: string } = {
	[RESTORE_STATUS.RUNNING    ] : 'Running',
	[RESTORE_STATUS.COMPLETE   ] : 'Complete',
	[RESTORE_STATUS.FAILED     ] : 'Finished with failures',
	[RESTORE_STATUS.STOPPED    ] : 'Stopped',
	[RESTORE_STATUS.INTERRUPTED] : 'Interrupted',
} as const;

/** Outcome of a single `SnapshotRestoreActions` row */
export const RESTORE_RESULT = {
	PENDING : 0,
	OK      : 1,
	FAILED  : 2,
	/** Nothing to do - the target was already gone, or already in the desired state */
	SKIPPED : 3,
} as const;

export const DIFF_CHANGE_TYPE = {
	CREATE: 0,
	UPDATE: 1,
	DELETE: 2
} as const;

/**
 * How a change type is drawn to users. Shared by the restore preview's per-category breakdown and
 * the action list, which would otherwise each carry their own copy and drift.
 *
 * The delete marker is U+2212 MINUS SIGN, not a hyphen - it lines up with `+` at Discord's font
 * weights, where a hyphen reads as half a character.
 */
export const DIFF_CHANGE_PREFIX: { [K in keyof typeof DIFF_CHANGE_TYPE as (typeof DIFF_CHANGE_TYPE)[K]]: string } = {
	[DIFF_CHANGE_TYPE.CREATE]: '+',
	[DIFF_CHANGE_TYPE.UPDATE]: '~',
	[DIFF_CHANGE_TYPE.DELETE]: '−'
} as const;