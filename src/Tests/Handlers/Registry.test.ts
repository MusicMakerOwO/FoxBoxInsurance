import { describe, it, expect, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { TOS_FEATURES } from '../../TOSConstants.js';
import { GUILD_FEATURES } from '../../Typings/DatabaseTypes.js';
import { DiscordPermissions } from '../../Utils/DiscordConstants.js';
import { ButtonHandler, CommandHandler } from '../../Typings/HandlerTypes.js';
import { LoadRegistry } from '../Components/Helpers.js';

/**
 * Every component handler, checked as a whole: that each one is reachable (barrel export, unique
 * customID, every rendered custom_id routes somewhere), and that each one carries the gates it is
 * meant to. Generalises `Restore/Wiring.test.ts`'s registration checks to the whole bot.
 *
 * The gate table is the single place a gate change shows up in review - a handler that loses its
 * Administrator requirement fails here by name.
 */

const { query } = vi.hoisted(() => ({ query: vi.fn(() => { throw new Error('unexpected query'); }) }));
vi.mock('../../Database.js', () => ({ Database: { query } }));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HANDLER_FOLDERS = [ 'Buttons', 'Menus', 'Modals' ] as const;

/** Every non-index `.ts` file under a folder, recursively */
async function SourceFiles(folder: string): Promise<string[]> {
	const entries = await readdir(join(ROOT, folder), { withFileTypes: true, recursive: true });
	return entries
		.filter(entry => entry.isFile() && entry.name.endsWith('.ts') && entry.name !== 'index.ts')
		.map(entry => relative(ROOT, join(entry.parentPath, entry.name)));
}

/**
 * The customID a file declares, read off its source rather than by importing it - a handler that is
 * missing from the barrel is exactly the file no import of the barrel would ever reach.
 */
async function DeclaredID(file: string): Promise<string | null> {
	const contents = await readFile(join(ROOT, file), 'utf8');
	return /customID\s*:\s*'([^']+)'/.exec(contents)?.[1] ?? null;
}

type Kind = 'buttons' | 'menus' | 'modals';
const FOLDER_KIND: Record<typeof HANDLER_FOLDERS[number], Kind> = { Buttons: 'buttons', Menus: 'menus', Modals: 'modals' };

describe('handler registration', () => {
	it.each(HANDLER_FOLDERS)('exports every %s handler file from the barrel', async (folder) => {
		const registry = await LoadRegistry();
		const map = registry[FOLDER_KIND[folder]];
		const files = await SourceFiles(folder);
		expect(files.length).toBeGreaterThan(0);

		for (const file of files) {
			const id = await DeclaredID(file);
			if (id === null) continue; // a shared renderer rather than a handler

			expect.soft(map.has(id), `${file} ('${id}') is not exported from ${folder}/index.ts`).toBe(true);
		}
	});

	// The Map keeps whichever registered last, so a clash is a silently unreachable handler
	it.each(HANDLER_FOLDERS)('gives every %s handler a distinct customID', async (folder) => {
		const owners = new Map<string, string>();
		for (const file of await SourceFiles(folder)) {
			const id = await DeclaredID(file);
			if (id === null) continue;

			expect.soft(owners.get(id), `${file} and ${owners.get(id)} both declare '${id}'`).toBeUndefined();
			owners.set(id, file);
		}
	});

	/**
	 * Static half of the routing check - `ExpectValidResponse` does the per-kind half at render time.
	 * Every quoted literal on a `custom_id:` line counts, so both arms of a ternary are checked.
	 */
	it('backs every custom_id rendered in src/ with a registered handler', async () => {
		const { buttons, menus, modals } = await LoadRegistry();
		const NOT_HANDLERS = new Set([
			'null', // disabled page counters
			'data'  // modal text inputs / selects, read back through `fields`
		]);

		const files = (await SourceFiles('.')).filter(file => !file.startsWith('Tests') && !file.startsWith('Typings'));
		let found = 0;

		for (const file of files) {
			const contents = await readFile(join(ROOT, file), 'utf8');
			for (const line of contents.split('\n')) {
				const at = line.indexOf('custom_id:');
				if (at === -1) continue;

				for (const [ , id ] of line.slice(at).matchAll(/['"`]([a-zA-Z-]+)(?=[_'"`])/g)) {
					found++;
					if (NOT_HANDLERS.has(id)) continue;
					expect.soft(buttons.has(id) || menus.has(id) || modals.has(id), `${file} renders '${id}', which no barrel exports`).toBe(true);
				}
			}
		}

		expect(found, 'the custom_id scan matched nothing - has the source style changed?').toBeGreaterThan(50);
	});
});

//////////////////
// Gates
//////////////////

const T = TOS_FEATURES;
const G = GUILD_FEATURES;
const ADMIN = DiscordPermissions.Administrator;

type Gates = { tos: number[], guild: number[], perms: bigint[], type: ButtonHandler['response_type'] };

function gates(tos: number[], guild: number[], perms: bigint[], type: Gates['type']): Gates {
	return { tos, guild, perms, type };
}

const EXPORT = (type: Gates['type'] = 'update') => gates([ T.MESSAGE_EXPORTS ], [ G.EXPORT_MESSAGES ], [], type);
const MANAGE = (type: Gates['type'] = 'update') => gates([ T.SERVER_SNAPSHOTS ], [ G.MANAGE_SNAPSHOTS ], [ ADMIN ], type);
const IMPORT = (type: Gates['type'] = 'update') => gates([ T.IMPORT_SNAPSHOTS ], [ G.IMPORT_SNAPSHOTS ], [ ADMIN ], type);
const RESTORE = (type: Gates['type']) => gates([ T.SERVER_SNAPSHOTS ], [ G.RESTORE_SNAPSHOTS ], [ ADMIN ], type);
const OPEN = (type: Gates['type'] = 'update') => gates([], [], [], type);

const BUTTON_GATES: Record<string, Gates> = {
	// Same gates as /activity - the chart's span buttons would otherwise keep serving data after the
	// server disables message history
	'activity'              : gates([ T.MESSAGE_EXPORTS ], [ G.MESSAGE_HISTORY ], [], 'update'),
	'close'                 : OPEN(),
	// Intentionally ungated, like /data-collection: Discord requires that every user can reach the
	// opt-out, whatever terms they have or have not accepted
	'data-collection'       : OPEN(),
	'global-stats'          : OPEN(),
	'history'               : OPEN(),
	'bot-info'              : OPEN(),
	'tos-accept'            : OPEN(),
	// Intentionally ungated: storing a timezone is harmless (see DELEGATION_EXCEPTIONS)
	'set-timezone'          : OPEN('modal'),

	'export-main'           : EXPORT(),
	'export-format'         : EXPORT(),
	'export-cancel'         : EXPORT(),
	'export-finish'         : EXPORT(),
	'export-channel'        : EXPORT('modal'),
	'export-messages'       : EXPORT('modal'),

	'import'                : IMPORT(),
	'import-view'           : IMPORT(),
	'import-confirm'        : IMPORT(),
	'import-cancel'         : IMPORT(),
	// Intentionally no guild feature: reachable from snapshot-manage on a managed import
	'import-view-channels'  : gates([ T.IMPORT_SNAPSHOTS ], [], [ ADMIN ], 'update'),
	'import-view-roles'     : gates([ T.IMPORT_SNAPSHOTS ], [], [ ADMIN ], 'update'),
	'import-view-bans'      : gates([ T.IMPORT_SNAPSHOTS ], [], [ ADMIN ], 'update'),

	'snapshot-list'         : MANAGE(),
	'snapshot-manage'       : MANAGE(),
	'snapshot-view'         : MANAGE(),
	'snapshot-view-channels': MANAGE(),
	'snapshot-view-roles'   : MANAGE(),
	'snapshot-view-bans'    : MANAGE(),
	'snapshot-pin'          : MANAGE(),
	'snapshot-delete'       : MANAGE(),
	'snapshot-export'       : MANAGE(),

	'restore-options'       : RESTORE('reply'),
	'restore-toggle'        : RESTORE('update'),
	'restore-preview'       : RESTORE('update'),
	'restore-actions'       : RESTORE('update'),
	'restore-plan'          : RESTORE('update'),
	'restore-confirm'       : RESTORE('modal'),
	'restore-stop'          : RESTORE('reply'),
	'restore-log'           : RESTORE('reply'),
	'restore-retry'         : RESTORE('reply'),
	'restore-safety'        : RESTORE('reply')
};

const MENU_GATES: Record<string, Gates> = {
	'command-help'    : OPEN('reply'),
	'exportInfo'      : OPEN('reply'),
	'pick-timezone'   : OPEN(),
	'snapshot-view'   : MANAGE(),
	'restore-preset'  : RESTORE('update'),
	'restore-category': RESTORE('update')
};

const MODAL_GATES: Record<string, Gates> = {
	'export-channel' : EXPORT(),
	'export-messages': EXPORT(),
	'restore-start'  : RESTORE('reply'),
	'set-timezone'   : OPEN()
};

function GatesOf(handler: ButtonHandler): Gates {
	return {
		tos  : [ ...handler.tos_features ].sort(),
		guild: [ ...handler.guild_features ].sort(),
		perms: [ ...handler.permissions ],
		type : handler.response_type
	};
}

describe('handler gates', () => {
	it.each([
		[ 'buttons', BUTTON_GATES ],
		[ 'menus', MENU_GATES ],
		[ 'modals', MODAL_GATES ]
	] as const)('%s carry exactly the gates in the table', async (kind, table) => {
		const map = (await LoadRegistry())[kind];

		// Both directions, so a new handler without a row fails as loudly as a changed one
		expect([ ...map.keys() ].sort()).toEqual(Object.keys(table).sort());
		for (const [ id, handler ] of map) {
			expect.soft(GatesOf(handler as ButtonHandler), `${kind} '${id}'`).toEqual(table[id]);
		}
	});
});

//////////////////
// Delegation
//////////////////

/**
 * A handler that calls another handler's `execute` directly skips the dispatcher's gate check for
 * the target, so it must be gated at least as strictly itself. Each entry names the delegation and
 * why it is allowed to be looser.
 */
const DELEGATION_EXCEPTIONS: Record<string, string> = {
	'Modals/SetTimezone.ts -> buttons:activity': 'storing a timezone is harmless; accepted window to the chart (decided 2026-10-02)',
	'Menus/PickTimezone.ts -> buttons:activity': 'same as the set-timezone modal',
	'Commands/Snapshot.ts -> buttons:snapshot-list': 'checks MANAGE_SNAPSHOTS in code - /snapshot enable/disable must stay reachable while it is off',
	'Commands/Snapshot.ts -> buttons:snapshot-manage': 'same as snapshot-list',
	'Commands/Snapshot.ts -> buttons:import': 'intentional: /snapshot import is not held to the import TOS or guild feature (decided 2026-10-02)'
};

type Gated = Pick<CommandHandler, 'tos_features' | 'guild_features' | 'permissions'>;

/** What `target` requires that `source` does not. Administrator covers any permission. */
function Missing(source: Gated, target: Gated): string[] {
	const missing: string[] = [];
	for (const tos of target.tos_features) {
		if (!source.tos_features.includes(tos)) missing.push(`TOS feature ${tos}`);
	}
	for (const feature of target.guild_features) {
		if (!source.guild_features.includes(feature)) missing.push(`guild feature ${feature}`);
	}
	if (!source.permissions.includes(ADMIN)) {
		for (const permission of target.permissions) {
			const name = Object.entries(DiscordPermissions).find(([ , value ]) => value === permission)?.[0];
			if (!source.permissions.includes(permission)) missing.push(`permission ${name ?? permission}`);
		}
	}
	return missing;
}

describe('delegation', () => {
	async function Delegations() {
		const registry = await LoadRegistry();
		const found: { key: string, source: Gated, target: Gated }[] = [];

		for (const folder of [ ...HANDLER_FOLDERS, 'Commands' ]) {
			for (const file of await SourceFiles(folder)) {
				const contents = await readFile(join(ROOT, file), 'utf8');
				const sourceID = /customID\s*:\s*'([^']+)'/.exec(contents)?.[1] ?? /setName\('([^']+)'\)/.exec(contents)?.[1];
				if (!sourceID) continue;

				const sourceKind = folder === 'Commands' ? 'commands' : FOLDER_KIND[folder as typeof HANDLER_FOLDERS[number]];
				const source = registry[sourceKind].get(sourceID);
				expect(source, `${file} declares '${sourceID}' but it is not registered`).toBeDefined();

				for (const [ , kind, targetID ] of contents.matchAll(/client\.(buttons|commands|menus|modals)\.get\('([^']+)'\)/g)) {
					const target = registry[kind as keyof typeof registry].get(targetID);
					expect(target, `${file} delegates to unregistered ${kind}:'${targetID}'`).toBeDefined();
					found.push({ key: `${file} -> ${kind}:${targetID}`, source: source!, target: target! });
				}
			}
		}
		return found;
	}

	it('gates every delegating handler at least as strictly as its target', async () => {
		const delegations = await Delegations();
		expect(delegations.length).toBeGreaterThan(5);

		for (const { key, source, target } of delegations) {
			if (key in DELEGATION_EXCEPTIONS) continue;
			expect.soft(Missing(source, target), key).toEqual([]);
		}
	});

	it('finds every listed exception, so stale ones get removed', async () => {
		const keys = new Set((await Delegations()).map(delegation => delegation.key));
		for (const key of Object.keys(DELEGATION_EXCEPTIONS)) {
			expect.soft(keys.has(key), `exception '${key}' no longer matches a delegation`).toBe(true);
		}
	});
});
