import { Client, SlashCommandBuilder, Message, InteractionReplyOptions, ContextMenuCommandBuilder } from 'discord.js';
import { ChatInputCommandInteraction, ButtonInteraction as _Button, UserSelectMenuInteraction, StringSelectMenuInteraction, RoleSelectMenuInteraction, ModalSubmitInteraction, UserContextMenuCommandInteraction, MessageContextMenuCommandInteraction, AutocompleteInteraction as _Autocomplete} from 'discord.js';
type AnySelectMenuInteraction = UserSelectMenuInteraction | StringSelectMenuInteraction | RoleSelectMenuInteraction;
type AnyContextMenu = UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction;
import ShardManager from './Utils/Sharding/ShardManager';
import Collector from './Utils/Overrides/Collector';
import TimedCache from './Utils/TimedCache';

import Log from './Utils/Logs';
import CachePool from './Utils/Caching/CachePool';

export enum ExportFormats {
	TEXT = 'txt',
	JSON = 'json',
	HTML = 'html',
	CSV = 'csv'
}

export type ExportOptions = {
	guildID: string;
	channelID: string;
	maxMessages: number;
	format: ExportFormats;
	timestamp: Date;
	options: {
		images: boolean; // Attachments, emojis, and stickers
		integrity: boolean; // Check internal hashes to prevent tampering on the host
		bots: boolean;
		largeFiles: boolean; // Larger than 8MB - Depends on `attachments`
	}
}

export type ExportResult = {
	data: Buffer;
	hash: string; // md5
	counts: {
		messages: number;
		attachments: number;
		emojis: number;
		stickers: number;
		embeds: number;
	}
}

type AssetDimensions = {
	width: number;
	height: number;
}

export interface BasicAsset {
	id: string;
	url: string;
	name: string;
	extension: string;
	dimensions: AssetDimensions | null; // Things like text files don't have dimensions lol
}

export interface EmojiAsset extends BasicAsset {
	animated: boolean;
}

// Doesn't add anything but it's here for consistency
export interface AttachmentAsset extends BasicAsset {
	messageID: string;
}

export interface StickerAsset extends BasicAsset {
	description: string | null;
	format: StickerFormats; // number, index starting at 1, corrected in parser
}

export enum StickerFormats {
	PNG = 1,
	APNG = 2,
	Lottie = 3,
	GIF = 4
}

export interface BasicEmbed {
	// This is here for completeness and avoid nested loops
	// It's a little bit more ram but the coede is simpler
	id: string;
	messageID: string;

	title: string | null;
	description: string | null;
	url: string | null;
	timestamp: string | null;
	color: number | null;

	// Unwraping objects make it easier for the database
	footer_text: string | null;
	footer_icon: string | null;

	thumbnail_url: string | null;

	image_url: string | null;

	author_name: string | null;
	author_url: string | null;
	author_icon: string | null;

	fields: EmbedField[];
}

export interface EmbedField {
	name: string;
	value: string;
	inline?: boolean;
}

export interface User {
	id: string;
	username: string;
	icon: BasicAsset; // default avatars will be calculated by the parser
	bot: boolean;
}

export interface Member extends User {
	guildID: string;
	joinedAt: string | null; // ISO 8601 - Only if user joins while bot is in the guild
	leftAt: string | null; // Same as above but for leaving 
}

export interface Channel {
	guildID: string; // Again with the loop prevention
	id: string;
	name: string;
	type: number;
	parentID: string | null; // null = no category
}

export interface Guild {
	id: string;
	name: string;
	icon: BasicAsset | null;
}

export interface BasicMessage {
	guild: Guild; // We are ignoring DMs so always present
	channel: Channel,
	user: User & { joinedAt: string }, // It can't possibly be null because how can you send a message outside of the server?
	id: string;
	content: string;
	embeds: BasicEmbed[];
	emojis: EmojiAsset[];
	attachments: AttachmentAsset[];
	sticker: StickerAsset | null;
}

// This is the outlier lol
export interface EventFile {
	name: string;
	once?: boolean;
	execute: (client: MicroClient, ...args: any[]) => any;
}

export interface File {
	// whitelists
	roles?: string[];
	users?: string[];
	channels?: string[];
	guilds?: string[];

	// Permissions
	userPerms?: string[];
	botPerms?: string[];

	// Flags
	dev?: boolean;
	cooldown?: number;
	cache?: boolean;
	defer?: boolean;
	owner?: boolean;

	// Alias(es)
	alias?: string | string[]; // gets converted to 'aliases' in the loader
	aliases: string | string[];
}

// Slash Commands, Autocomplete
export interface CommandFile extends File {
	data: SlashCommandBuilder;
	autocomplete?: (interaction: MicroInteraction, client: MicroClient, args?: string[]) => Promise<any>;
	execute: (interaction: MicroInteraction, client: MicroClient, args?: string[]) => Promise<any>;
}

export interface ContextFile extends File {
	data: ContextMenuCommandBuilder;
	execute: (interaction: MicroInteraction, client: MicroClient, args?: string[]) => Promise<any>;
}

// Buttons, Modals, Menus
export interface ComponentFile extends File {
	customID: string;
	execute: (interaction: MicroInteraction, client: MicroClient, args?: string[]) => Promise<any>;
}

// Messages
export interface MessageFile extends File {
	name: string;
	description: string;
	execute: (message: Message, client: MicroClient, args?: string[]) => Promise<any>;
}

export interface ComponentError {
	message: string;
	stack: string[];
	lines: string[];
}

export interface MicroClient extends Client {
	config: Record<string, any>;
	logs: typeof Log;
	cooldowns: Map<string, number>;
	activeCollectors: Map<string, any>;
	responseCache: Map<string, any>;
	shards: ShardManager;
	fileErrors: Map<string, ComponentError>;

	// it's part of the builtin EventEmitter but TS doesn't like it lol
	_events: Record<string, Function[]>;

	// Components
	context: Map<string, CommandFile>;
	commands: Map<string, CommandFile>;
	buttons: Map<string, ComponentFile>;
	menus: Map<string, ComponentFile>;
	modals: Map<string, ComponentFile>;
	messages: Map<string, MessageFile>;

	// Caching
	messageCache: CachePool<BasicMessage>;
	downloadQueue: [table: string, id: string, url: string][];
	exportCache: TimedCache<string, ExportOptions>;
}

export interface MicroInteractionResponse extends InteractionReplyOptions {
	hidden?: boolean;
}

export interface InteractionOverrides {
	reply: (options: string | MicroInteractionResponse) => Promise<any>;
	editReply: (options: string | MicroInteractionResponse) => Promise<any>;
	deferReply: (options: string | MicroInteractionResponse) => Promise<any>;
	deferUpdate: (options: string | MicroInteractionResponse) => Promise<any>;
	deleteReply: (message?: string) => Promise<any>;
	followUp: (options: string | MicroInteractionResponse) => Promise<any>;
	fetchReply: (message?: string) => Promise<any>;
	showModal: (modal: any) => Promise<any>;

	createCollector: () => Collector;

	allowCache: boolean; // used internally to determine if the response should be cached
}

export type CommandInteraction 			= InteractionOverrides & ChatInputCommandInteraction;
export type ButtonInteraction 			= InteractionOverrides & _Button;
export type MenuInteraction 			= InteractionOverrides & AnySelectMenuInteraction;
export type ModalInteraction 			= InteractionOverrides & ModalSubmitInteraction;
export type MessageContextInteraction 	= InteractionOverrides & MessageContextMenuCommandInteraction;
export type UserContextInteraction 		= InteractionOverrides & UserContextMenuCommandInteraction;
export type AutocompleteInteraction 	= InteractionOverrides & _Autocomplete;

export type MicroInteraction = CommandInteraction | ButtonInteraction | MenuInteraction | ModalInteraction | MessageContextInteraction | UserContextInteraction | AutocompleteInteraction;

interface IPCMessage {
	type: number;
	shardID: number;
	requestID: string;
	data?: any;
}