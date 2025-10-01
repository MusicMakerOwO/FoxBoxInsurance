const preLoadStart = process.hrtime.bigint();

require('dotenv').config({ path: __dirname + '/.env' });

// Check for required environment variables
if (!process.env.TOKEN) {
	console.error('Could not find a TOKEN in .env');
	console.error('Did you forget to create a .env file?');
	process.exit(1);
}

const config = require('./config.json');

const ConfigTemplate = {
	APP_ID: 'string',
	DEV_GUILD_ID: 'string',

	PREFIX: 'string',

	HOT_RELOAD: 'boolean',
	PROCESS_HANDLERS: 'boolean',
	CHECK_INTENTS: 'boolean',
	CHECK_EVENT_NAMES: 'boolean',
	REGISTER_COMMANDS: 'boolean',
	FANCY_ERRORS: 'boolean'
}

for (const [key, type] of Object.entries(ConfigTemplate)) {
	if (!(key in config)) {
		Log.error(`[~] Missing ${key} in config.json`);
		process.exit(1);
	}

	if (typeof config[key] !== type) {
		Log.error(`[~] Expected ${key} to be a ${type} in config.json - Got ${typeof config[key]} instead`);
		process.exit(1);
	}
}

const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');

const Log = require('./Utils/Logs');
const ComponentLoader = require('./Utils/ComponentLoader');
const WebSocketLoader = require('./Utils/WebSocketLoader');
const EventLoader = require('./Utils/EventLoader');
const RegisterCommands = require('./Utils/RegisterCommands');
const CheckIntents = require('./Utils/CheckIntents');
const FileWatch = require('./Utils/FileWatcher');

const client = require('./client.js');
const WebSocket = require('ws');

const Debounce = require('./Utils/Timing/Debounce');
const CachePool = require('./Utils/Caching/CachePool');
const Database = require('./Utils/Database');
const ProcessMessages = require('./Utils/Processing/Messages');
const { DownloadAssets } = require('./Utils/Processing/Images');
const LinkAssets = require('./Utils/Processing/LinkAssets');
const Task = require('./Utils/TaskScheduler');
const { StartTasks } = require('./Utils/Tasks/AutomaticTasks');
const UploadFiles = require('./Utils/Tasks/UploadFiles');
const EncryptMessages = require('./Utils/Tasks/EncryptMessages');
const PushStats = require('./Utils/Tasks/PushStats');
const { UPLOAD_CACHE, DOWNLOAD_CACHE, FAILED_MESSAGES, WebSocketOpCodes } = require('./Utils/Constants');
const TTLCache = require('./Utils/Caching/TTLCache.js');
const HashObject = require('./Utils/HashObject.js');

if (!existsSync(UPLOAD_CACHE)) mkdirSync(UPLOAD_CACHE, { recursive: true });
if (!existsSync(DOWNLOAD_CACHE)) mkdirSync(DOWNLOAD_CACHE, { recursive: true });
if (!existsSync(FAILED_MESSAGES)) mkdirSync(FAILED_MESSAGES, { recursive: true });

const preLoadEnd = process.hrtime.bigint();
const preLoadTime = (preLoadEnd - preLoadStart) / BigInt(1e6); // convert to milliseconds
Log.custom(`Preload time: ${preLoadTime}ms`, 0x7946ff);

client.config = config;
client.logs = Log;
client.cooldowns = new Map(); // guildID::userID -> timestamp
client.ttlcache = new TTLCache();
client.messageCache = new CachePool(3); // 3 caches combined in one, great for race conditions

// These are all empty but need to be defined for the ComponentLoader
// They will be populated automatically, see below
client.commands = new Map();
client.buttons = new Map();
client.menus = new Map();
client.modals = new Map();

client.websockets = new Map(); // op_code -> websocket handler

// file path : [component type, component cache]
const COMPONENT_FOLDERS = {
	'./Commands': client.commands,
	'./Buttons' : client.buttons,
	'./Menus'   : client.menus,
	'./Modals'  : client.modals,

	'./Events'  : null // handled separately
}

// The values here will be replaced with the file contents, or null if the file does not exist
const PRESET_FILES = {
	'./Commands': './Presets/Command',
	'./Buttons' : './Presets/Button',
	'./Menus'   : './Presets/Menu',
	'./Modals'  : './Presets/Modal',
	'./Events'  : './Presets/Event'
}

for (const [componentFolder, presetFile] of Object.entries(PRESET_FILES)) {

	const fullPresetPath = `${__dirname}/${presetFile}`;

	if (!existsSync(fullPresetPath)) {
		Log.error(`The preset "${presetFile}" file does not exist - Check the relative path!`);
		PRESET_FILES[componentFolder] = null;
		continue;
	}

	if (!(componentFolder in COMPONENT_FOLDERS)) {
		Log.error(`The folder "${componentFolder}" does not exist in the COMPONENT_FOLDERS lookup`);
		PRESET_FILES[componentFolder] = null;
		continue;
	}

	const data = readFileSync(fullPresetPath, 'utf-8');
	if (data.length > 0) PRESET_FILES[componentFolder] = data;
}

WebSocketLoader(`${__dirname}/WebSockets`, client.websockets);
Log.debug(`Loaded ${client.websockets.size} WebSocket Handlers`);

for (const [path, cache] of Object.entries(COMPONENT_FOLDERS)) {
	const fullPath = `${__dirname}/${path}`;
	if (cache === null) {
		EventLoader(client, fullPath);
		let ListenerCount = 0;
		for (const listeners of Object.values(client._events)) {
			ListenerCount += Array.isArray(listeners) ? listeners.length : 1;
		}
		Log.debug(`Loaded ${ListenerCount} Events`);
		continue;
	}

	if (!cache) {
		Log.error(`No cache found for ${fullPath}`);
		continue;
	}

	if (!existsSync(fullPath)) {
		Log.error(`The '${fullPath.split('/')[1]}' folder does not exist - Check the relative path!`);
		delete COMPONENT_FOLDERS[fullPath]; // remove it from the lookup so it doesn't get checked later
		delete PRESET_FILES[fullPath];
		continue;
	}

	ComponentLoader(fullPath, cache);

	Log.debug(`Loaded ${cache.size} ${fullPath.split('/').pop()}`);
}

// This will only check intents loaded by the event loader
// If they are defined below this point they will not be checked
if (config.CHECK_INTENTS) {
	CheckIntents(client);
} else {
	Log.warn('Intent checking is disabled in config.json');
}

RegisterCommands(client);

async function HotReload(cache, componentFolder, filePath, type = 0) {
	if (type !== 0) return; // 0 = file, 1 = directory, 2 = symlink

	const isEvent = cache === null;

	const oldComponent = require(filePath);

	// repopulate the cache, register commands if needed
	delete require.cache[ require.resolve(filePath) ];

	if (isEvent) {
		client.removeAllListeners();
		EventLoader(client, `${__dirname}/${componentFolder}`);
		let ListenerCount = 0;
		for (const listeners of Object.values(client._events)) {
			ListenerCount += listeners.length;
		}
		Log.debug(`Loaded ${ListenerCount} events`);
		return;
	}

	cache.clear();

	ComponentLoader(`${__dirname}/${componentFolder}`, cache);
	Log.debug(`Loaded ${cache.size} ${componentFolder.split('/')[1]}`);

	// Check by reference, not by cache contents
	if (cache == client.commands && existsSync(filePath)) {
		const newComponent = require(filePath);
		try {
			const oldCommandData = oldComponent.data?.toJSON() ?? {};
			const newCommandData = newComponent.data?.toJSON() ?? {};
			if (JSON.stringify(oldCommandData) !== JSON.stringify(newCommandData)) {
				await RegisterCommands(client);
			}
		} catch (error) {
			Log.error(error);
		}
	}
}

function PresetFile(componentFolder, callback, filePath, type = 0) {
	if (type !== 0) return; // 0 = file, 1 = directory, 2 = symlink

	const presetData = PRESET_FILES[componentFolder];
	if (!presetData) return;

	const fileData = readFileSync(filePath, 'utf-8');
	// If you rename a file then it won't be empty
	// This will prevent overwriting existing files
	if (fileData.length === 0) {
		writeFileSync(filePath, presetData);
	}

	// reload the cache
	callback(filePath);
}

// deferred promise
const dbInitPromise = Database.Initialize();

let ws;

function connect() {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.close();
	}
	ws = new WebSocket('wss://api.notfbi.dev/');

	ws.on('open', () => {
		Log.debug('Connected to the API WebSocket');
	});

	ws.on('message', async (raw) => {
		const parsed = JSON.parse(raw.toString());

		if (!parsed.op || typeof parsed.op !== 'number') {
			Log.error(`Invalid op_code in WebSocket message: ${parsed.op}`);
			return;
		}

		parsed.d ??= {}; // null | undefined -> {}
		if (typeof parsed.d !== 'object' || Array.isArray(parsed.d)) {
			Log.error(`Invalid data in WebSocket message: ${parsed.d}`);
			return;
		}

		if (parsed.op === WebSocketOpCodes.HEARTBEAT) {
			return ws.send(JSON.stringify({ op: WebSocketOpCodes.HEARTBEAT_ACK }));
		}

		console.log(parsed);

		if (parsed.op === WebSocketOpCodes.HELLO) {
			Log.debug(`Received HELLO from the API WebSocket`);
			const opCodeHash = HashObject(WebSocketOpCodes);
			return ws.send(JSON.stringify({ op: WebSocketOpCodes.IDENTIFY, d: { auth: process.env.WEBSOCKET_AUTH, op_codes_hash: opCodeHash } }));
		}

		if (parsed.op === WebSocketOpCodes.SHUTTING_DOWN) {
			Log.error('Websocket is being shut down');
			ws = null;
			return;
		}

		const handler = client.websockets.get(parsed.op);
		if (!handler) {
			Log.error(`No handler for op_code ${parsed.op}`);
			return;
		}

		try {
			const response = await handler.handler(parsed.d);
			if (!response) return; // no response needed
			if (typeof response !== 'object' || Array.isArray(response)) {
				throw new Error(`Invalid response type from WebSocket handler for op_code ${parsed.op} - Must be an object`);
			}
			if (typeof response.op !== 'number') {
				throw new Error(`Invalid response op_code from WebSocket handler for op_code ${parsed.op} - Must be a number`);
			}
			if (response.d !== 'undefined' && typeof response.d !== 'object') {
				throw new Error(`Invalid response data from WebSocket handler for op_code ${parsed.op} - Must be an object or undefined`);
			}
			ws.send(JSON.stringify({ op: WebSocketOpCodes.OK, seq: parsed.seq ?? null, ... response }));
		} catch (error) {
			Log.error(`Error in WebSocket handler for op_code ${parsed.op}`);
			Log.error(error);
		}
	});

	ws.on('close', (code, reason) => {
		Log.warn(`WS closed (code=${code}, reason=${reason})`);
		setTimeout(connect, 2000);
	});

	ws.on('error', (err) => {
		Log.error('WS error', err);
	});
}

// connect();

Log.info(`Logging in...`);
client.login(process.env.TOKEN);
client.on('ready', async function () {
	Log.custom(`Logged in as ${client.user.tag}!`, 0x7946ff);

	await dbInitPromise;
	Log.custom('Database initialized', 0x7946ff);

	Task.schedule( ProcessMessages.bind(null, client.messageCache), 1000 * 60 * 30); // 30 minutes

	const connection = await Database.getConnection();
	const savedGuilds = new Set(await connection.query('SELECT id FROM Guilds').then(rows => rows.map(g => g.id)) );

	if (savedGuilds.size < client.guilds.cache.size) {
		const guildsToInsert = [];

		for (const guild of client.guilds.cache.values()) {
			if (savedGuilds.has(guild.id)) continue; // already saved
			guildsToInsert.push([guild.id, guild.name]);
		}

		if (guildsToInsert > 0) {
			await connection.batch('INSERT INTO Guilds (id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)', guildsToInsert);
			Log.success(`Inserted ${guildsToInsert.length} new guilds into the database`);
		}
	}

	Database.releaseConnection(connection);

	StartTasks();
	UploadFiles();

	if (!config.HOT_RELOAD) {
		Log.warn('Hot reload is disabled in config.json');
		return;
	}

	for (const [path, cache] of Object.entries(COMPONENT_FOLDERS)) {
		const watcher = new FileWatch(`${__dirname}/${path}`, true);
		const callback = Debounce(HotReload.bind(null, cache, path), 2_000);
		watcher.onAdd = PresetFile.bind(null, path, callback);
		watcher.onRemove = callback;
		watcher.onChange = callback;
	}
});

async function Shutdown() {
	console.log();

	Log.warn('Shutting down...');
	await client.destroy();
	ws?.close();
	client.ttlcache.destroy();

	Log.warn('Stopping tasks...');
	Task.destroy();

	Log.warn('Clearing caches...');
	await ProcessMessages(client.messageCache).catch(Log.error);

	Log.warn('Downloading assets...');
	await DownloadAssets().catch(Log.error);

	Log.warn('Linking assets...');
	await LinkAssets().catch(Log.error);

	Log.warn('Encrypting messages...');
	await EncryptMessages().catch(Log.error);

	Log.warn('Pushing stats...');
	await PushStats().catch(Log.error);

	Log.warn('Closing database connection...');
	await Database.destroy();

	process.exit(0);
}


process.on('SIGINT', Shutdown); // ctrl+c
process.on('SIGTERM', Shutdown); // docker stop

// ctrl+z is not a graceful shutdown, it's a pause but we don't want to pause lol
process.on('SIGTSTP', Shutdown);

// standard uncaught errors
process.on('uncaughtException', Log.error);
process.on('unhandledRejection', Log.error);