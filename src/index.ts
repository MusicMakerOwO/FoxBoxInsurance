import { EncryptMessages } from "./Utils/Tasks/EncryptMessages";

const preloadStart = process.hrtime.bigint();

import "source-map-support/register";

import * as dotenv from "dotenv";
dotenv.config({ path: `${__dirname}/../.env` });

import {Log} from './Utils/Log';
import {TaskScheduler} from "./Utils/TaskScheduler";
import {Database} from "./Database";
import {StartAutomaticTasks} from "./Utils/Tasks/AutomaticTasks";
import {DownloadAssets} from "./Utils/Processing/Images";
import {client} from './Client';
import {ProcessMessages} from "./Events/Messages";
import {SaveGuild} from "./CRUD/Guilds";

import * as Commands from "./Commands";
import * as Buttons from "./Buttons";
import * as Menus from "./Menus";
import * as Modals from "./Modals";
import * as Events from "./Events";

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
	client.on(event.name, event.execute);
}

const preloadEnd = process.hrtime.bigint();
const preloadTime = Number(preloadEnd - preloadStart) / 1e6;
Log('DEBUG', `Preload time: ${~~preloadTime}ms`);

Log('INFO', `Logging in...`);
void client.login(process.env.TOKEN);
client.on('clientReady', function () {
	Log('DEBUG', `Logged in as ${client.user!.tag}!`);

	for (const guild of client.guilds.cache.values()) {
		void SaveGuild(guild);
	}

	void StartAutomaticTasks()
});

const ErrorCallback = Log.bind(null, 'ERROR');

let isShuttingDown = false;
async function Shutdown() {
	if (isShuttingDown) return;
	isShuttingDown = true;

	console.log();

	const start = process.hrtime.bigint();

	Log('WARN', 'Shutting down...');
	await client.destroy().catch(ErrorCallback);

	Log('WARN', 'Stopping tasks...');
	TaskScheduler.destroy();

	Log('WARN', 'Flushing caches...');
	await ProcessMessages().catch(ErrorCallback);
	await DownloadAssets().catch(ErrorCallback);

	Log('WARN', 'Encrypting messages...');
	await EncryptMessages().catch(ErrorCallback);

	Log('WARN', 'Closing database...');
	await Database.destroy().catch(ErrorCallback);

	const end = process.hrtime.bigint();
	const duration = Number(end - start) / 1_000_000;

	Log('WARN', `Done! (took ${duration.toFixed(2)}ms)`);
	process.exit(0);
}

process.on('SIGINT', Shutdown); // ctrl+c
process.on('SIGTERM', Shutdown); // docker stop

// ctrl+z is not a graceful shutdown, it's a pause, but we don't want to pause lol
process.on('SIGTSTP', Shutdown);

// standard uncaught errors
process.on('uncaughtException', (error) => Log('ERROR', error));
process.on('unhandledRejection', (error) => Log('ERROR', error));