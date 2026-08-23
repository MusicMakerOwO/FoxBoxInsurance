import {Client} from 'discord.js';
import {ButtonHandler, CommandHandler, ModalHandler, SelectMenuHandler} from "./Typings/HandlerTypes.js";
import {TTLCache} from "./Utils/DataStructures/TTLCache.js";
import {ChannelExport, CreateExportCacheKey} from "./Typings/CacheEntries.js";

interface IClient extends Client<true> {
	commands : Map<string, CommandHandler>;
	buttons  : Map<string, ButtonHandler>;
	menus    : Map<string, SelectMenuHandler>;
	modals   : Map<string, ModalHandler>;

	/** Temporary holding of message export options */
	exportCache: TTLCache<ReturnType<typeof CreateExportCacheKey>, ChannelExport>;
}

const client = new Client({
	intents: [
		'Guilds',
		'GuildMembers',
		'MessageContent',
		'GuildMessages',
		'DirectMessages',
		'GuildBans'
	]
}) as IClient;

client.commands = new Map();
client.buttons = new Map();
client.menus = new Map();
client.modals = new Map();

client.exportCache = new TTLCache();

export { client, IClient }