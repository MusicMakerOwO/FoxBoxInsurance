// node app.js 0 1
const shardID = parseInt(process.argv[2]);
const shardCount = parseInt(process.argv[3]);
if (shardID && isNaN(shardCount)) {
	console.error('Shard ID was set but no shard count was defined');
	process.exit(1);
}

// These 2 modules run on automatically so we don't care about the return value
import './Utils/Overrides/Interactions';
import './Utils/Overrides/InteractionEvents';

import './Utils/ProcessHandler';

if (!process.send) require('./Utils/CheckPackages');

import ShardManager from './Utils/Sharding/ShardManager';
import ComponentLoader from './Utils/ComponentLoader';
import EventLoader from './Utils/EventLoader';
import Log from './Utils/Logs';
import RegisterCommands from './Utils/RegisterCommands';
import FileWatch from './Utils/FileWatch';
import CheckIntents from './Utils/CheckIntents';

import { MicroClient } from './typings';
import { Client } from 'discord.js';
import CachePool from './Utils/Caching/CachePool';

import SaveMessages from './Utils/Storage/SaveMessages';
import DownloadAssets from './Utils/Storage/DownloadAssets';
import Database from './Utils/Database';
import CreateBackup, { BackupType } from './Utils/Storage/CreateBackup';
import TimedCache from './Utils/TimedCache';

const client = new Client({
	... isFinite(shardID) ? { shards: [shardID, shardCount] } : {},
	intents: [
		'MessageContent',
		'GuildMessages',
		'DirectMessages'
	]
}) as MicroClient;

// type checking done in the index.js
client.config = require('../config.json');
client.logs = Log;
client.cooldowns = new Map<string, number>(); // guildID::userID -> timestamp
client.activeCollectors = new Map<string, any>(); // messageID -> collector
client.responseCache = new Map<string, any>(); // messageID -> response
client.shards = new ShardManager(client, shardID, shardCount);// class will not initialize if shardID is not a number, reduces memory overhead

client.messageCache = new CachePool(3);
client.downloadQueue = [];
client.exportCache = new TimedCache(1000 * 60 * 10); // 10 minutes

function ProcessMessages() {
	// It's a little funky but CachePool.pool is a getter so JS will return a pointer
	// However when we call Switch() then the pointer now points to the new pool, not the old one
	// So we need to point to the array DIRECTLY instead of the getter
	const currentPool = Array.from(client.messageCache.pools[client.messageCache.currentPool]);

	// We will fill up the next pool while we wait for the save to finish
	client.messageCache.switch();
	// Make sure the cache is empty so we don't save duplicates
	client.messageCache.clear(client.messageCache.currentPool);

	SaveMessages(currentPool);
}

function CreateBackups() {
	const currentHour = new Date().getHours();
	for (const guild of client.guilds.cache.values()) {
		if (BigInt(guild.id) % 24n === BigInt(currentHour)) {
			CreateBackup(guild, client, BackupType.AUTOMATIC);
		}
	}
}


process.on('SIGINT', CloseProgram);
function CloseProgram() {
	client.logs.info('Cleaning up...');

    clearInterval(TickInterval);
    client.destroy();

	client.exportCache.stopCleanup();
	
	ProcessMessages();
    DownloadAssets(client.downloadQueue).then(() => {
		try {
			Database.pragma('wal_checkpoint(RESTART)'); // Clear the WAL file
			Database.pragma('analysis_limit=8000'); // Set the analysis limit to 8000
			Database.exec('ANALYZE'); // Analyze database for better query planning and optimization
			Database.exec('VACUUM'); // Clear any empty space in the database
		} catch (err) {
			console.error('Error during database cleanup:', err);
		} finally {
			Database.close();
			process.exit(0);
		}
	});
}


let seconds = 0;
const TickInterval = setInterval(TickProgram, 1000);
function TickProgram() {
	seconds++;
	
	if (seconds % (60 * 15) === 0) {
		ProcessMessages();
	}

	if (seconds % (60) === 0) {
		DownloadAssets(client.downloadQueue);
	}

	if (seconds % (60 * 60) === 0) {
		CreateBackups();
	}
}

const modules = [
	'commands',
	'buttons',
	'menus',
	'modals',
	// 'context',
	// 'messages',
];

for (let i = 0; i < modules.length; i++) {
	const module = modules[i];
	// @ts-ignore
	ComponentLoader(client, module);
	// The map is initialized in the ComponentLoader
	// @ts-ignore - TS doesn't like dynamic properties
	client.logs.debug(`Loaded ${client[module].size} ${module}`);
}

EventLoader(client);
let ListenerCount = 0;
for (const listeners of Object.values(client._events)) {
	ListenerCount += listeners.length;
}
// DJS adds a default 'shardDisconnect' listener that we ignore
client.logs.debug(`Loaded ${ListenerCount - 1} events`);

// This will only check intents loaded by the event loader
// If they are defined below this point they will not be checked
CheckIntents(client);

if (isNaN(shardID)) {
	// We only register if the bot isn't started by the shard manager
	// The manger does a dynamic register but we don't have that luxury here
	client.logs.info(`Started refreshing application (/) commands`);
	RegisterCommands(client);
	client.logs.info(`Successfully reloaded application (/) commands`);
}

client.logs.info(`Logging in...`);
client.login(client.config.TOKEN);
client.on('ready', function () {
	client.logs.custom(`Logged in as ${client.user!.tag}!`, 0x7946ff);

	CreateBackups();

	if (!process.send) {
		FileWatch(client); // listener for hot loading
	} else {
		client.shards.broadcastReady();
	}
});