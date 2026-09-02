import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
	DIFF_CHANGE_PREFIX,
	DIFF_CHANGE_TYPE,
	RESTORE_OPTION_NAMES,
	RESTORE_OPTIONS,
	RESTORE_PRESETS,
	RESTORE_RESULT,
	RESTORE_STATUS,
	RESTORE_STATUS_NAMES
} from '../../Utils/Constants.js';
import { GUILD_FEATURES } from '../../Typings/DatabaseTypes.js';
import { ObjectValues } from '../../Typings/HelperTypes.js';

/**
 * §15 - the invariants that hold the restore feature together but live in no single function:
 * constant tables that must stay in step with each other, the schema backfill's hardcoded feature
 * bit, and the barrel registration that `CLAUDE.md` warns is not auto-discovered from disk.
 *
 * That last one is Bug #1's shape exactly: `Buttons/Restore/Retry.ts` existed and rendered a
 * button, but nothing exported it, so every click was a dead interaction.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

type Handler = { customID: string };

async function BarrelIDs(barrel: Record<string, unknown>): Promise<Set<string>> {
	return new Set(Object.values(barrel).map(handler => (handler as Handler).customID));
}

describe('restore constants', () => {
	it('gives every option a distinct power of two', () => {
		const values = Object.values(RESTORE_OPTIONS);

		expect(new Set(values).size).toBe(values.length);
		for (const value of values) {
			expect.soft(value & (value - 1), `${value} is not a power of two`).toBe(0);
		}
	});

	it('builds FULL out of the three implemented categories and leaves messages out', () => {
		expect(RESTORE_PRESETS.FULL).toBe(RESTORE_OPTIONS.CHANNELS | RESTORE_OPTIONS.ROLES | RESTORE_OPTIONS.BANS);
		expect(RESTORE_PRESETS.FULL & RESTORE_OPTIONS.MESSAGES).toBe(0);
		expect(RESTORE_PRESETS.STRUCTURE).toBe(RESTORE_OPTIONS.CHANNELS | RESTORE_OPTIONS.ROLES);
		expect(RESTORE_PRESETS.BANS).toBe(RESTORE_OPTIONS.BANS);
		expect(RESTORE_PRESETS.CUSTOM).toBe(0);
	});

	it('names every option in the embed table', () => {
		for (const bit of Object.values(RESTORE_OPTIONS)) {
			expect.soft(RESTORE_OPTION_NAMES[bit], `${bit} has no display name`).toBeTruthy();
		}
	});

	// `DescribeFailureGroup` destructures the noun pair, so a missing entry throws mid-render
	it('gives every option a singular/plural noun pair for failure summaries', async () => {
		const source = await readFile(join(ROOT, 'Utils', 'Snapshots', 'RestoreFailures.ts'), 'utf8');
		const nouns = source.slice(source.indexOf('CATEGORY_NOUNS'), source.indexOf('};', source.indexOf('CATEGORY_NOUNS')));

		for (const key of Object.keys(RESTORE_OPTIONS)) {
			expect.soft(nouns, `CATEGORY_NOUNS is missing ${key}`).toContain(`RESTORE_OPTIONS.${key}`);
		}
	});

	// `RenderAction` falls back to 'UNKNOWN', so a gap is silent in the downloadable log
	it('gives every option a plain log name', async () => {
		const source = await readFile(join(ROOT, 'Buttons', 'Restore', 'Log.ts'), 'utf8');
		const names = source.slice(source.indexOf('CATEGORY_NAMES'), source.indexOf('};', source.indexOf('CATEGORY_NAMES')));

		for (const key of Object.keys(RESTORE_OPTIONS)) {
			expect.soft(names, `CATEGORY_NAMES is missing ${key}`).toContain(`RESTORE_OPTIONS.${key}`);
		}
	});

	it('names every run status', () => {
		for (const status of Object.values(RESTORE_STATUS)) {
			expect.soft(RESTORE_STATUS_NAMES[status], `status ${status} has no display name`).toBeTruthy();
		}
	});

	it('gives every change type a display prefix', () => {
		const values = Object.values(DIFF_CHANGE_TYPE);

		for (const change of values) {
			expect.soft(DIFF_CHANGE_PREFIX[change], `change type ${change} has no prefix`).toBeTruthy();
		}
		expect(new Set(Object.values(DIFF_CHANGE_PREFIX)).size).toBe(values.length);
	});

	it('keeps the run statuses and action results disjoint value sets of their own', () => {
		expect(new Set(Object.values(RESTORE_STATUS)).size).toBe(Object.values(RESTORE_STATUS).length);
		expect(new Set(Object.values(RESTORE_RESULT)).size).toBe(Object.values(RESTORE_RESULT).length);
	});
});

describe('guild feature bit', () => {
	it('holds a unique bit for RESTORE_SNAPSHOTS', () => {
		const values: ObjectValues<typeof GUILD_FEATURES>[] = Object.values(GUILD_FEATURES);

		expect(GUILD_FEATURES.RESTORE_SNAPSHOTS).toBe(64);
		expect(values.filter(value => value === GUILD_FEATURES.RESTORE_SNAPSHOTS)).toHaveLength(1);
	});

	// Bug #2: existing guilds never got the bit, so the Restore button was dead on every server that
	// predated the feature. The backfill fixes that, but hardcodes the number
	it('matches the number DB_SETUP.sql backfills', async () => {
		const schema = await readFile(join(ROOT, '..', 'DB_SETUP.sql'), 'utf8');
		const backfill = schema.split('\n').find(line => line.includes('UPDATE Guilds SET features'));

		expect(backfill, 'DB_SETUP.sql no longer backfills the restore feature bit').toBeDefined();
		expect(backfill).toContain(`features | ${GUILD_FEATURES.RESTORE_SNAPSHOTS}`);
		expect(backfill).toContain(`(features & ${GUILD_FEATURES.RESTORE_SNAPSHOTS}) = 0`);
	});
});

describe('handler registration', () => {
	/** Every non-index handler file in a folder, since nothing is auto-discovered from disk at runtime */
	async function HandlerFiles(folder: string, filter: (name: string) => boolean): Promise<string[]> {
		const entries = await readdir(join(ROOT, folder), { withFileTypes: true });
		return entries
			.filter(entry => entry.isFile() && entry.name.endsWith('.ts') && entry.name !== 'index.ts' && filter(entry.name))
			.map(entry => join(folder, entry.name));
	}

	/**
	 * The customID a file declares, read off its source rather than by importing it - a bundler
	 * cannot resolve a fully dynamic import, and a handler that is missing from the barrel is
	 * exactly the file no import of the barrel would ever reach.
	 */
	async function DeclaredID(file: string): Promise<string | null> {
		const contents = await readFile(join(ROOT, file), 'utf8');
		return /customID\s*:\s*'([^']+)'/.exec(contents)?.[1] ?? null;
	}

	async function ExpectRegistered(files: string[], registered: Set<string>, barrel: string): Promise<void> {
		expect(files.length, `no handler files found for ${barrel}`).toBeGreaterThan(0);

		for (const file of files) {
			const id = await DeclaredID(file);
			if (id === null) continue; // a shared renderer rather than a handler

			expect.soft(registered.has(id), `${file} ('${id}') is not exported from ${barrel}`).toBe(true);
		}
	}

	it('exports every Buttons/Restore handler from its barrel', async () => {
		const registered = await BarrelIDs(await import('../../Buttons/Restore/index.js'));
		const files = await HandlerFiles('Buttons/Restore', () => true);
		await ExpectRegistered(files, registered, 'Buttons/Restore/index.ts');
	});

	it('exports every restore menu and modal from its barrel', async () => {
		const menus = await BarrelIDs(await import('../../Menus/index.js'));
		const modals = await BarrelIDs(await import('../../Modals/index.js'));

		await ExpectRegistered(await HandlerFiles('Menus', name => name.startsWith('Restore')), menus, 'Menus/index.ts');
		await ExpectRegistered(await HandlerFiles('Modals', name => name.startsWith('Restore')), modals, 'Modals/index.ts');
	});

	/**
	 * The other half of Bug #1: `Retry.ts` was missing entirely, so the button the completion embed
	 * rendered pointed at nothing. A barrel check alone would not have caught that - the custom_id
	 * has to be traced back to a handler that exists.
	 */
	it('backs every custom_id the restore screens render with a registered handler', async () => {
		const registered = new Set([
			...await BarrelIDs(await import('../../Buttons/index.js')),
			...await BarrelIDs(await import('../../Menus/index.js')),
			...await BarrelIDs(await import('../../Modals/index.js'))
		]);

		const sources = [
			...await HandlerFiles('Buttons/Restore', () => true),
			...await HandlerFiles('Menus', name => name.startsWith('Restore')),
			...await HandlerFiles('Modals', name => name.startsWith('Restore')),
			join('Services', 'RestoreRunner.ts'),
			join('Buttons', 'Snapshots', 'Manage.ts') // where the Restore button itself lives
		];

		for (const source of sources) {
			const contents = await readFile(join(ROOT, source), 'utf8');

			// Interpolated ids only - the one static custom_id in this feature is the action list's
			// disabled `'null'` page counter, which is deliberately not a handler
			for (const [ , id ] of contents.matchAll(/custom_id: `([a-z-]+)[_`]/g)) {
				expect.soft(registered.has(id), `${source} renders '${id}', which no barrel exports`).toBe(true);
			}
		}
	});
});