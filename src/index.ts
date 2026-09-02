const preloadStart = process.hrtime.bigint();

// Must stay the first import - see the file for why
import "./Utils/ProcessTimezone.js";

import "source-map-support/register.js";

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));

import * as dotenv from "dotenv";
dotenv.config({ path: `${__dirname}/../.env` });

import {Log} from './Utils/Log.js';
import {TaskScheduler} from "./Utils/TaskScheduler.js";
import {Database} from "./Database.js";
import {StartAutomaticTasks} from "./Utils/Tasks/AutomaticTasks.js";
import {DownloadAssets} from "./Utils/Processing/Images.js";
import {client} from './Client.js';
import {ProcessMessages} from "./Events/Messages.js";
import {SaveGuild} from "./CRUD/Guilds.js";
import {EncryptMessages} from "./Utils/Tasks/EncryptMessages.js";
import {UploadFiles} from "./Utils/Tasks/UploadFiles.js";
import {ReconcileInterruptedRestores, StopActiveRestores} from "./Services/RestoreRunner.js";

import * as Commands from "./Commands/index.js";
import * as Buttons from "./Buttons/index.js";
import * as Menus from "./Menus/index.js";
import * as Modals from "./Modals/index.js";
import * as Events from "./Events/index.js";

for (const command of Object.values(Commands)) {
	client.commands.set(command.data.name, command);
	if ('aliases' in command) {
		for (const alias of command.aliases) {
			client.commands.set(alias, command);
		}
	}
}
for (const button of Object.values(Buttons)) {
	client.buttons.set(button.customID, button);
}
for (const menu of Object.values(Menus)) {
	client.menus.set(menu.customID, menu);
}
for (const modal of Object.values(Modals)) {
	client.modals.set(modal.customID, modal);
}
for (const event of Object.values(Events)) {
	client[event.once ? 'once' : 'on'](event.name, event.execute);
}

const preloadEnd = process.hrtime.bigint();
const preloadTime = Number(preloadEnd - preloadStart) / 1e6;
Log('DEBUG', `Preload time: ${~~preloadTime}ms`);

const pepper = process.env.PEPPER ? Buffer.from(process.env.PEPPER, 'base64') : null;
if (!pepper || pepper.length !== 32) {
	Log('ERROR', 'Missing or invalid PEPPER environment variable (must be 32 bytes, base64-encoded)');
	// eslint-disable-next-line unicorn/no-process-exit
	process.exit(1);
}

Log('INFO', `Logging in...`);
void client.login(process.env.TOKEN);
const ErrorCallback = Log.bind(null, 'ERROR');

client.on('clientReady', function () {
	Log('DEBUG', `Logged in as ${client.user!.tag}!`);

	for (const guild of client.guilds.cache.values()) {
		if (!guild.available) continue;
		void SaveGuild(guild);
	}

	// Any run still marked RUNNING was killed mid-restore. Report it honestly rather than leaving
	// its step log stuck on "Channels 12 / 25" forever
	void ReconcileInterruptedRestores().catch(ErrorCallback);

	void StartAutomaticTasks()
});

let isShuttingDown = false;
async function Shutdown() {
	if (isShuttingDown) return;
	isShuttingDown = true;

	console.log();

	const start = process.hrtime.bigint();

	Log('WARN', 'Shutting down...');

	// Before client.destroy(), or the final step log edit has no connection to go out on
	Log('WARN', 'Stopping restores...');
	await StopActiveRestores().catch(ErrorCallback);

	await client.destroy().catch(ErrorCallback);

	Log('WARN', 'Stopping tasks...');
	TaskScheduler.destroy();

	Log('WARN', 'Flushing caches...');
	await ProcessMessages().catch(ErrorCallback);
	await DownloadAssets().catch(ErrorCallback);
	await UploadFiles().catch(ErrorCallback);

	Log('WARN', 'Encrypting messages...');
	await EncryptMessages().catch(ErrorCallback);

	Log('WARN', 'Closing database...');
	await Database.destroy().catch(ErrorCallback);

	const end = process.hrtime.bigint();
	const duration = Number(end - start) / 1_000_000;

	Log('WARN', `Done! (took ${duration.toFixed(2)}ms)`);
	// eslint-disable-next-line unicorn/no-process-exit
	process.exit(0);
}

process.on('SIGINT', Shutdown); // ctrl+c
process.on('SIGTERM', Shutdown); // docker stop

// ctrl+z is not a graceful shutdown, it's a pause, but we don't want to pause lol
process.on('SIGTSTP', Shutdown);

// standard uncaught errors
process.on('uncaughtException', (error) => Log('ERROR', error));
process.on('unhandledRejection', (error) => Log('ERROR', error));