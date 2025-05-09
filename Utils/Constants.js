const ROOT_FOLDER = `${__dirname}/..`;

const DB_SETUP_FILE = `${ROOT_FOLDER}/DB_SETUP.sql`;
const DB_FILE = `${ROOT_FOLDER}/fbi.sqlite`;

// If we lose internet we will dump the cache in here and read it back on startup
const DOWNLOAD_CACHE = `${ROOT_FOLDER}/DownloadCache`;
const UPLOAD_CACHE = `${ROOT_FOLDER}/UploadCache`;
const FAILED_MESSAGES = `${ROOT_FOLDER}/FailedMessages`;
const DATABASE_BACKUPS = `${ROOT_FOLDER}/DatabaseBackups`;

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

// Reverse the format object so we can use the values as keys
// Allows for human readable format names
for (const [k, v] of Object.entries(FORMAT)) {
	FORMAT[v] = k;
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
	'Uploading your secret ... (oops)',
	'Reading the database a bedtime story. ..', 
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
		description: RandomLoadingMessage()
	}
}

module.exports = {
	ROOT_FOLDER,

	DB_SETUP_FILE,
	DB_FILE,

	DOWNLOAD_CACHE,
	UPLOAD_CACHE,
	FAILED_MESSAGES,
	DATABASE_BACKUPS,

	SECONDS,
	COLOR,
	FORMAT,
	LOADING_MESSAGES,

	RandomLoadingMessage,
	RandomLoadingEmbed
}