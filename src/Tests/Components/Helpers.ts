import { Mock, vi } from 'vitest';
import {
	ButtonInteraction,
	ChatInputCommandInteraction,
	GuildMember,
	ModalSubmitInteraction,
	PermissionsBitField,
	StringSelectMenuInteraction
} from 'discord.js';
import { APIEmbed, APIModalInteractionResponseCallbackData } from 'discord-api-types/v10';
import { DiscordButton, DiscordStringSelect } from '../../Typings/DiscordTypes.js';
import {
	ButtonHandler,
	CommandHandler,
	InteractionResponse,
	ModalHandler,
	SelectMenuHandler
} from '../../Typings/HandlerTypes.js';
import { IClient } from '../../Client.js';
import { TTLCache } from '../../Utils/DataStructures/TTLCache.js';

/**
 * Shared helpers for every component response suite - no tests of its own.
 *
 * Handlers return data and never reply (see CLAUDE.md), so most suites call `execute()` directly and
 * assert on the returned object. `ExpectValidResponse` holds every screen to Discord's limits plus
 * the framework's own rules, so a limit violation is caught wherever a screen is rendered rather than
 * being listed per handler.
 *
 * `LoadRegistry` / `makeClient` / `ExpectValidResponse` import the real handler barrels, which reach
 * `Database.js` - callers must `vi.mock('../../Database.js', ...)` (or the relative equivalent) so a
 * stray query is a loud failure instead of `Database.Initialize` calling `process.exit(1)`.
 */

//////////////////
// Result accessors
//////////////////

export type HandlerResult = Awaited<ReturnType<ButtonHandler['execute']>>;

/** A screen rather than a modal; a modal (`title`) means the wrong branch was taken */
export function screen(result: HandlerResult): InteractionResponse {
	if ('title' in result) throw new Error('expected an interaction response, got a modal');
	return result;
}

export function embedOf(result: HandlerResult): APIEmbed {
	const embeds = screen(result).embeds;
	if (!embeds || embeds.length === 0) throw new Error('expected an embed');
	return embeds[0];
}

export function componentsOf(result: HandlerResult): (DiscordButton | DiscordStringSelect)[] {
	return (screen(result).components ?? []).flatMap(row => row.components as (DiscordButton | DiscordStringSelect)[]);
}

export function buttonsOf(result: HandlerResult): DiscordButton[] {
	return componentsOf(result).filter((component): component is DiscordButton => component.type === 2);
}

export function selectsOf(result: HandlerResult): DiscordStringSelect[] {
	return componentsOf(result).filter((component): component is DiscordStringSelect => component.type === 3);
}

/** Button custom_ids in render order, with link buttons contributing their url */
export function customIDs(result: HandlerResult): string[] {
	return buttonsOf(result).map(button => 'custom_id' in button ? button.custom_id : button.url);
}

//////////////////
// Interactions
//////////////////

export type InteractionKind = 'button' | 'menu' | 'modal' | 'command';

const PROTOTYPES = {
	button: ButtonInteraction.prototype,
	menu  : StringSelectMenuInteraction.prototype,
	modal : ModalSubmitInteraction.prototype,
	command: ChatInputCommandInteraction.prototype
} as const;

export type InteractionOptions = {
	kind?       : InteractionKind;
	customId?   : string;
	/** What the command dispatcher routes on; only meaningful for `kind: 'command'` */
	commandName?: string;
	guildId?    : string;
	/** The channel the interaction came from - what export sessions are keyed on */
	channelId?  : string;
	/** Backs `guild.channels.cache`, keyed by channel id */
	channels?   : Map<string, unknown>;
	/** Backs `fields.getSelectedChannels(id)`, keyed by the select's custom_id */
	selectedChannels?: Record<string, unknown>;
	userId?     : string;
	ownerId?    : string;
	/** `undefined` leaves `member` unset, like a DM */
	memberPerms?: bigint[];
	values?     : string[];
	/** Modal text inputs, keyed by their custom_id */
	fields?     : Record<string, string>;
	deferred?   : boolean;
	replied?    : boolean;
};

/**
 * A stub carrying a genuine component prototype, so `instanceof` checks (CheckHandlerAccess's
 * deferral branch) behave as they do live. `setPrototypeOf` rather than `new` because the real
 * constructors want a live client and a raw API payload.
 *
 * Every acknowledgement method is a spy; the defers also flip `deferred` like discord.js does, so a
 * dispatcher that checks `deferred` after `CheckHandlerAccess` sees the real state.
 */
type Spied = 'reply' | 'editReply' | 'deleteReply' | 'followUp' | 'showModal' | 'deferReply' | 'deferUpdate';

/**
 * Typed as a button carrying a menu's `values` and a modal's `fields` - a full intersection of the
 * three collapses to `never` on `componentType`. Cast when handing it to a menu or modal handler.
 */
export type MockInteraction = Omit<ButtonInteraction, Spied>
	& Pick<StringSelectMenuInteraction, 'values'>
	& Pick<ModalSubmitInteraction, 'fields'>
	& { [K in Spied]: Mock };

export function makeInteraction(options: InteractionOptions = {}): MockInteraction {
	const kind = options.kind ?? 'button';
	const guildId = options.guildId ?? '900000000000000006';
	const fields = options.fields ?? {};
	const selectedChannels = options.selectedChannels ?? {};

	const interaction = {
		customId : options.customId ?? 'test',
		commandName: options.commandName ?? 'test',
		guildId,
		channelId: options.channelId ?? '900000000000000008',
		guild    : {
			id      : guildId,
			name    : 'Test Guild',
			ownerId : options.ownerId ?? '900000000000000007',
			channels: { cache: options.channels ?? new Map() }
		},
		user    : { id: options.userId ?? '900000000000000005', tag: 'tester' },
		member  : options.memberPerms === undefined ? undefined : {
			permissions: new PermissionsBitField(options.memberPerms)
		} as GuildMember,
		values  : options.values ?? [],
		fields  : {
			getTextInputValue: (id: string) => {
				if (!(id in fields)) throw new Error(`no text input '${id}'`);
				return fields[id];
			},
			// A Collection in discord.js; handlers only ever call `first()`
			getSelectedChannels: (id: string) => {
				if (!(id in selectedChannels)) throw new Error(`no channel select '${id}'`);
				return { first: () => selectedChannels[id] };
			}
		},
		deferred: options.deferred ?? false,
		replied : options.replied ?? false,

		// Async like discord.js, so callers that chain or await the result behave as they do live
		reply      : vi.fn(async () => undefined),
		editReply  : vi.fn(async () => undefined),
		deleteReply: vi.fn(async () => undefined),
		followUp   : vi.fn(async () => undefined),
		showModal  : vi.fn(async () => undefined),
		deferReply : vi.fn(async function (this: { deferred: boolean }) { this.deferred = true; }),
		deferUpdate: vi.fn(async function (this: { deferred: boolean }) { this.deferred = true; })
	};

	return Object.setPrototypeOf(interaction, PROTOTYPES[kind]) as MockInteraction;
}

/** An ungated stand-in handler for dispatcher tests; `execute` is a spy returning `response` */
export function makeHandler(customID: string, overrides: Partial<ButtonHandler> = {}, response: unknown = { embeds: [], components: [] }): ButtonHandler {
	return {
		customID,
		tos_features  : [],
		guild_features: [],
		permissions   : [],
		response_type : 'update',
		hidden        : false,
		execute       : vi.fn(async () => response) as unknown as ButtonHandler['execute'],
		...overrides
	};
}

//////////////////
// Registry
//////////////////

export type Registry = {
	commands: Map<string, CommandHandler>;
	buttons : Map<string, ButtonHandler>;
	menus   : Map<string, SelectMenuHandler>;
	modals  : Map<string, ModalHandler>;
};

let registry: Promise<Registry> | null = null;

/**
 * The real barrels, keyed exactly as `src/index.ts` registers them. Imported lazily so the calling
 * test file's `vi.mock`s are in place first.
 */
export function LoadRegistry(): Promise<Registry> {
	registry ??= (async () => {
		const [ Commands, Buttons, Menus, Modals ] = await Promise.all([
			import('../../Commands/index.js'),
			import('../../Buttons/index.js'),
			import('../../Menus/index.js'),
			import('../../Modals/index.js')
		]);

		const commands = new Map<string, CommandHandler>();
		for (const command of Object.values(Commands) as CommandHandler[]) {
			commands.set(command.data.name, command);
			for (const alias of command.aliases ?? []) commands.set(alias, command);
		}

		return {
			commands,
			buttons: new Map((Object.values(Buttons) as ButtonHandler[]).map(handler => [ handler.customID, handler ])),
			menus  : new Map((Object.values(Menus) as SelectMenuHandler[]).map(handler => [ handler.customID, handler ])),
			modals : new Map((Object.values(Modals) as ModalHandler[]).map(handler => [ handler.customID, handler ]))
		};
	})();
	return registry;
}

/** The registry maps on a client stub, plus a fresh export session cache */
export async function makeClient(): Promise<IClient> {
	const { commands, buttons, menus, modals } = await LoadRegistry();
	return {
		commands,
		buttons,
		menus,
		modals,
		exportCache: new TTLCache()
	} as unknown as IClient;
}

//////////////////
// Response contract
//////////////////

const LIMIT = {
	ROWS          : 5,
	ROW_BUTTONS   : 5,
	SELECT_OPTIONS: 25,
	OPTION_TEXT   : 100,
	BUTTON_LABEL  : 80,
	CUSTOM_ID     : 100,
	EMBEDS        : 10,
	EMBED_TITLE   : 256,
	EMBED_DESC    : 4096,
	EMBED_FOOTER  : 2048,
	EMBED_TOTAL   : 6000,
	MODAL_TITLE   : 45,
	MODAL_ROWS    : 5,
	INPUT_LABEL   : 45,
	INPUT_HOLDER  : 100
} as const;

/** The custom_id disabled page counters carry - deliberately not a handler */
const PLACEHOLDER_ID = 'null';

function Prefix(customID: string): string {
	return customID.split('_')[0];
}

function Fail(problems: string[]): void {
	if (problems.length > 0) throw new Error(`Invalid response:\n- ${problems.join('\n- ')}`);
}

/**
 * Throws listing every rule `result` breaks. `handler` is whatever produced the screen - only its
 * `response_type` is read.
 *
 * Beyond Discord's own limits:
 * - every button/select custom_id must route to a registered handler of the matching kind
 * - `ephemeral` / `flags` are rejected: visibility is fixed at defer time and editReply ignores them,
 *   so they only mislead the reader
 * - an `update` response must say what its components are (`[]` is fine) - omitting the key leaves
 *   the previous screen's buttons live under the new embed
 */
export async function ExpectValidResponse(result: HandlerResult, handler: Pick<ButtonHandler, 'response_type'>): Promise<void> {
	if ('title' in result) throw new Error('expected an interaction response, got a modal - use ExpectValidModal');
	if (result.delete === true) return;

	// A follow-up is a fresh ephemeral message, so it's held to the reply rules on its own
	if (result.followUp !== undefined) {
		const others = Object.keys(result).filter(key => key !== 'followUp');
		if (others.length > 0) Fail([ `a 'followUp' response must set nothing else, got ${others.map(key => `'${key}'`).join(', ')} - the dispatcher would drop them` ]);
		if (result.followUp.followUp !== undefined || result.followUp.delete !== undefined) Fail([ `a 'followUp' payload cannot itself carry 'followUp' or 'delete'` ]);
		return ExpectValidResponse(result.followUp, { response_type: 'reply' });
	}

	const { buttons, menus } = await LoadRegistry();
	const problems: string[] = [];

	for (const key of [ 'ephemeral', 'flags' ]) {
		if (key in result) problems.push(`'${key}' is ignored by editReply - visibility comes from the handler's 'hidden'`);
	}

	if (handler.response_type === 'update' && !('components' in result)) {
		problems.push(`an 'update' response must set 'components' - the previous screen's components would survive`);
	}

	const embeds = result.embeds ?? [];
	if (embeds.length > LIMIT.EMBEDS) problems.push(`${embeds.length} embeds, more than ${LIMIT.EMBEDS}`);
	for (const [ i, embed ] of embeds.entries()) {
		if ((embed.title?.length ?? 0) > LIMIT.EMBED_TITLE) problems.push(`embed ${i} title is ${embed.title!.length} chars, over ${LIMIT.EMBED_TITLE}`);
		if ((embed.description?.length ?? 0) > LIMIT.EMBED_DESC) problems.push(`embed ${i} description is ${embed.description!.length} chars, over ${LIMIT.EMBED_DESC}`);
		if ((embed.footer?.text.length ?? 0) > LIMIT.EMBED_FOOTER) problems.push(`embed ${i} footer is ${embed.footer!.text.length} chars, over ${LIMIT.EMBED_FOOTER}`);
	}

	// Discord sums the text of every embed in the message
	const embedTotal = embeds.reduce((total, embed) => total
		+ (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0) + (embed.author?.name.length ?? 0)
		+ (embed.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0), 0);
	if (embedTotal > LIMIT.EMBED_TOTAL) problems.push(`embeds hold ${embedTotal} chars combined, over ${LIMIT.EMBED_TOTAL}`);

	const rows = result.components ?? [];
	if (rows.length > LIMIT.ROWS) problems.push(`${rows.length} action rows, more than ${LIMIT.ROWS}`);

	const seenIDs = new Set<string>();
	function CheckCustomID(customID: string, where: string): void {
		if (customID.length > LIMIT.CUSTOM_ID) problems.push(`${where} custom_id '${customID}' is ${customID.length} chars, over ${LIMIT.CUSTOM_ID}`);
		if (seenIDs.has(customID)) problems.push(`${where} custom_id '${customID}' is duplicated within the message`);
		seenIDs.add(customID);
	}

	for (const [ r, row ] of rows.entries()) {
		const components = row.components as (DiscordButton | DiscordStringSelect)[];
		const selects = components.filter(component => component.type === 3);
		const rowButtons = components.filter(component => component.type === 2);

		if (selects.length > 0 && components.length > 1) problems.push(`row ${r} has a select sharing its row`);
		if (rowButtons.length > LIMIT.ROW_BUTTONS) problems.push(`row ${r} has ${rowButtons.length} buttons, more than ${LIMIT.ROW_BUTTONS}`);
		if (components.length === 0) problems.push(`row ${r} is empty`);

		for (const select of selects as DiscordStringSelect[]) {
			const where = `select '${select.custom_id}'`;
			CheckCustomID(select.custom_id, where);
			if (!menus.has(Prefix(select.custom_id))) problems.push(`${where} has no handler in the menus map`);

			const options = select.options;
			if (options.length === 0 || options.length > LIMIT.SELECT_OPTIONS) {
				problems.push(`${where} has ${options.length} options, must be 1-${LIMIT.SELECT_OPTIONS}`);
			}
			const values = options.map(option => option.value);
			if (new Set(values).size !== values.length) problems.push(`${where} has duplicate option values`);
			for (const option of options) {
				for (const field of [ 'label', 'value', 'description' ] as const) {
					const text = option[field];
					if (text !== undefined && text.length > LIMIT.OPTION_TEXT) {
						problems.push(`${where} option ${field} '${text.slice(0, 20)}...' is ${text.length} chars, over ${LIMIT.OPTION_TEXT}`);
					}
				}
			}
		}

		for (const button of rowButtons as DiscordButton[]) {
			const where = `button '${button.label ?? '(no label)'}'`;
			if ((button.label?.length ?? 0) > LIMIT.BUTTON_LABEL) problems.push(`${where} label is ${button.label!.length} chars, over ${LIMIT.BUTTON_LABEL}`);

			if (button.style === 5) {
				if ('custom_id' in button) problems.push(`${where} is a link button with a custom_id`);
				if (!('url' in button) || !button.url) problems.push(`${where} is a link button without a url`);
				continue;
			}

			if (!('custom_id' in button) || !button.custom_id) {
				problems.push(`${where} is not a link button but has no custom_id`);
				continue;
			}

			CheckCustomID(button.custom_id, where);
			if (button.custom_id === PLACEHOLDER_ID) {
				if (!button.disabled) problems.push(`${where} uses the '${PLACEHOLDER_ID}' placeholder but is not disabled`);
			} else if (!buttons.has(Prefix(button.custom_id))) {
				problems.push(`${where} custom_id '${button.custom_id}' has no handler in the buttons map`);
			}
		}
	}

	Fail(problems);
}

/** Throws listing every rule a modal breaks - Discord's limits plus routing to the modals map */
export async function ExpectValidModal(result: HandlerResult): Promise<void> {
	if (!('title' in result)) throw new Error('expected a modal, got an interaction response');

	const { modals } = await LoadRegistry();
	const modal = result as APIModalInteractionResponseCallbackData;
	const problems: string[] = [];

	if (modal.title.length > LIMIT.MODAL_TITLE) problems.push(`title is ${modal.title.length} chars, over ${LIMIT.MODAL_TITLE}`);
	if (modal.custom_id.length > LIMIT.CUSTOM_ID) problems.push(`custom_id is ${modal.custom_id.length} chars, over ${LIMIT.CUSTOM_ID}`);
	if (!modals.has(Prefix(modal.custom_id))) problems.push(`custom_id '${modal.custom_id}' has no handler in the modals map`);

	const rows = modal.components;
	if (rows.length === 0 || rows.length > LIMIT.MODAL_ROWS) problems.push(`${rows.length} components, must be 1-${LIMIT.MODAL_ROWS}`);

	type ModalPart = { type: number, custom_id?: string, label?: string, placeholder?: string };

	for (const row of rows as (ModalPart & { components?: ModalPart[], component?: ModalPart })[]) {
		// Action rows (type 1) hold text inputs; label components (type 18) wrap a single input or select
		if (row.type === 18 && (row.label?.length ?? 0) > LIMIT.INPUT_LABEL) {
			problems.push(`label component '${row.label!.slice(0, 20)}...' is ${row.label!.length} chars, over ${LIMIT.INPUT_LABEL}`);
		}

		const inputs = row.components ?? (row.component ? [ row.component ] : []);
		for (const input of inputs) {
			if (input.type !== 4) continue;
			const where = `text input '${input.custom_id}'`;
			if ((input.label?.length ?? 0) > LIMIT.INPUT_LABEL) problems.push(`${where} label is ${input.label!.length} chars, over ${LIMIT.INPUT_LABEL}`);
			if ((input.placeholder?.length ?? 0) > LIMIT.INPUT_HOLDER) problems.push(`${where} placeholder is ${input.placeholder!.length} chars, over ${LIMIT.INPUT_HOLDER}`);
		}
	}

	Fail(problems);
}
