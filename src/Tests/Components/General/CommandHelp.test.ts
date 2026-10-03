import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { ExpectValidResponse, HandlerResult, LoadRegistry, embedOf, makeClient, makeInteraction, screen, selectsOf } from '../Helpers.js';

/**
 * `command-help` - the select under `/help`. It hands the picked command to `/help` and answers with
 * that command's detail screen as a new reply, leaving the list as it was. `/help` itself is covered
 * here too, since it renders the select.
 */

vi.mock('../../../Database.js', () => ({ Database: { query: vi.fn(() => { throw new Error('unexpected query'); }) } }));

const CommandHelp = (await import('../../../Menus/CommandHelp.js')).default;
const Help = (await import('../../../Commands/Help.js')).default;

let client: IClient;

beforeEach(async () => {
	client = await makeClient();
});

/** The distinct commands, without their aliases */
async function roots() {
	return [ ...new Set((await LoadRegistry()).commands.values()) ];
}

async function aliases(): Promise<[alias: string, root: string][]> {
	return (await roots()).flatMap(command => (command.aliases ?? []).map(alias => [ alias, command.data.name ] as [string, string]));
}

async function help(command: string | null): Promise<HandlerResult> {
	const interaction = { ...makeInteraction({ kind: 'command' }), options: { getString: () => command } };
	const result = await Help.execute(interaction as never, client);
	await ExpectValidResponse(result, Help);
	return result;
}

async function pick(value: string): Promise<HandlerResult> {
	const result = await CommandHelp.execute(makeInteraction({ kind: 'menu', values: [ value ] }) as never, client, []);
	await ExpectValidResponse(result, CommandHelp);
	return result;
}

describe('/help - the command list', () => {
	// Bug: aliases were listed as their own entries - 17 commands + 11 aliases = 28 options, and
	// Discord rejects a select over 25, so plain `/help` failed outright. ExpectValidResponse in
	// `help()` is what holds the limit; this pins what the options are.
	it('offers one option per command, without aliases', async () => {
		const options = selectsOf(await help(null))[0].options;

		expect(options.map(option => option.value).sort()).toEqual((await roots()).map(command => command.data.name).sort());
		expect(options.length).toBeLessThanOrEqual(25);
		for (const [ alias ] of await aliases()) {
			expect(options.map(option => option.value)).not.toContain(alias);
		}
	});

	it('routes the select to command-help', async () => {
		expect(selectsOf(await help(null))[0].custom_id).toBe('command-help');
	});

	it('lists every command once, alphabetically, with its aliases beside it', async () => {
		const lines = embedOf(await help(null)).description!.split('\n').filter(line => line.startsWith('  /'));
		const names = lines.map(line => line.trim().split(' ')[0]);

		expect(names).toEqual((await roots()).map(command => `/${command.data.name}`).sort());
		expect(lines).toContain('  /export (download)');
		expect(lines).toContain('  /info (stats, botinfo)');
		expect(lines).toContain('  /help');
	});

	it('counts commands, not aliases', async () => {
		expect(embedOf(await help(null)).description).toContain(`Available commands (${(await roots()).length} total)`);
	});

	it('falls back to the list for a command that does not exist', async () => {
		expect(selectsOf(await help('nope'))).toHaveLength(1);
	});
});

describe('/help - a command\'s detail screen', () => {
	it('shows the name, description, usage, examples and aliases', async () => {
		const description = embedOf(await help('help')).description!;

		expect(description).toContain('/help\n');
		expect(description).toContain('Get help with commands');
		expect(description).toContain('Usage: /help <command>');
		expect(description).toContain('Examples:\n  /help\n');
		expect(embedOf(await help('info')).description).toContain('Aliases:\n  /stats\n  /botinfo');
	});

	it('renders within limits for every command and alias', async () => {
		for (const name of (await LoadRegistry()).commands.keys()) {
			const result = await help(name); // ExpectValidResponse runs inside
			expect(selectsOf(result), name).toHaveLength(0);
		}
	});

	// editReply ignores `ephemeral`, so through the menu it posted publicly regardless
	it('carries no ephemeral key', async () => {
		expect(await help('help')).not.toHaveProperty('ephemeral');
	});
});

describe('/help - autocomplete', () => {
	async function complete(focused: string) {
		return Help.autocomplete!({ options: { getFocused: () => focused } } as never, client);
	}

	// Bug: all 28 names were returned, and Discord rejects more than 25 choices
	it('offers every command, without aliases, before anything is typed', async () => {
		const choices = await complete('');

		expect(choices.map(choice => choice.value)).toEqual((await roots()).map(command => command.data.name).sort());
		expect(choices.length).toBeLessThanOrEqual(25);
	});

	it('matches aliases once something is typed, with or without the slash', async () => {
		expect((await complete('down')).map(choice => choice.value)).toEqual([ 'download' ]);
		expect((await complete('/down')).map(choice => choice.name)).toEqual([ '/download' ]);
	});

	it('never returns more than 25 choices', async () => {
		for (const focused of [ 'e', 'a', 'o', '/' ]) {
			expect((await complete(focused)).length, focused).toBeLessThanOrEqual(25);
		}
	});

	it('every choice resolves to a detail screen', async () => {
		for (const choice of [ ...await complete(''), ...await complete('e') ]) {
			expect(selectsOf(await help(choice.value as string)), choice.name).toHaveLength(0);
		}
	});
});

describe('command-help', () => {
	it('returns the detail screen of the picked command', async () => {
		expect(await pick('export')).toEqual(await help('export'));
	});

	it('every option /help offers leads to that command\'s detail screen', async () => {
		for (const option of selectsOf(await help(null))[0].options) {
			const result = await pick(option.value);

			expect(embedOf(result).description, option.value).toContain(`/${option.value}\n`);
			expect(screen(result).components ?? [], option.value).toEqual([]);
		}
	});

	it('an alias shows its root command', async () => {
		for (const [ alias, root ] of await aliases()) {
			expect(embedOf(await pick(alias)).description, alias).toMatch(new RegExp(`^\`\`\`\\n/${root}\\n`));
		}
	});

	it('a value that is not a command falls back to the list rather than throwing', async () => {
		expect(selectsOf(await pick('nope'))).toHaveLength(1);
	});
});
