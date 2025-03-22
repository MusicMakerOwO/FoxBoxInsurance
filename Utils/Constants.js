const ROOT_FOLDER = `${__dirname}/..`;

const DB_SETUP_FILE = `${ROOT_FOLDER}/DB_SETUP.sql`;
const DB_FILE = `${ROOT_FOLDER}/fbi.sqlite`;

/**
 * If we lose internet we will dump the cache in here and read it back on startup
 */
const DOWNLOAD_CACHE = `${ROOT_FOLDER}/DownloadCache`;

const ASSETS_FOLDER = `${ROOT_FOLDER}/Assets`;
const GUILD_ICONS_FOLDER = `${ASSETS_FOLDER}/Guilds`;
const USER_ICONS_FOLDER = `${ASSETS_FOLDER}/Users`;
const EMOJI_FOLDER = `${ASSETS_FOLDER}/Emojis`;
const STICKER_FOLDER = `${ASSETS_FOLDER}/Stickers`;
const ATTACHMENTS_FOLDER = `${ASSETS_FOLDER}/Attachments`;

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

	ERROR: 0xff0000
}

const FORMAT = {
	TEXT: 'txt',
	JSON: 'json',
	CSV: 'csv',
	HTML: 'html'
}

// Reverse the format object so we can use the values as keys
// Allows for human readable format names
for (const [k, v] of Object.entries(FORMAT)) {
	FORMAT[v] = k;
}

module.exports = {
	ROOT_FOLDER,

	DB_SETUP_FILE,
	DB_FILE,

	DOWNLOAD_CACHE,
	
	ASSETS_FOLDER,
	GUILD_ICONS_FOLDER,
	USER_ICONS_FOLDER,
	EMOJI_FOLDER,
	STICKER_FOLDER,
	ATTACHMENTS_FOLDER,

	SECONDS,
	COLOR,
	FORMAT,
}