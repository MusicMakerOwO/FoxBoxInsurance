import {Client} from 'discord.js';
import {ButtonHandler, CommandHandler, ModalHandler, SelectMenuHandler} from "./Typings/HandlerTypes";
import {JSONSnapshot} from "./CRUD/Snapshots";
import {TTLCache} from "./Utils/DataStructures/TTLCache";
import {ChannelExport, CreateExportCacheKey} from "./Typings/CacheEntries";

interface IClient extends Client<true> {
	commands : Map<string, CommandHandler>;
	buttons  : Map<string, ButtonHandler>;
	menus    : Map<string, SelectMenuHandler>;
	modals   : Map<string, ModalHandler>;
	context  : Map<string, CommandHandler>;

	/** Temporary holding of message export options */
	exportCache: TTLCache<ReturnType<typeof CreateExportCacheKey>, ChannelExport>;

	/** Temporary holding of imported snapshots before saving for to a guild */
	importCache: TTLCache<JSONSnapshot['id'], JSONSnapshot>
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
client.context = new Map();

client.exportCache = new TTLCache();
client.importCache = new TTLCache();

export { client, IClient }