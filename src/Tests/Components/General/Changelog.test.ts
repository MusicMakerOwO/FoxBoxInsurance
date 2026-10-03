import { describe, it, expect, vi } from 'vitest';
import { COLOR } from '../../../Utils/Constants.js';
import { ExpectValidResponse, HandlerResult, embedOf, makeInteraction, screen } from '../Helpers.js';

/**
 * `/changelog` - one release, every release of a major (`N.0`), or the latest. Not a component, but
 * `bot-info` shows `LATEST_VERSION` and its responses are held to the same contract.
 */

vi.mock('../../../Database.js', () => ({ Database: { query: vi.fn(() => { throw new Error('unexpected query'); }) } }));

const { default: Changelog, LATEST_VERSION, CompareSemver } = await import('../../../Commands/Changelog.js');

async function changelog(version: string | null): Promise<HandlerResult> {
	const interaction = { ...makeInteraction({ kind: 'command' }), options: { getString: () => version } };
	const result = await Changelog.execute(interaction as never, {} as never);
	await ExpectValidResponse(result, Changelog);
	return result;
}

async function complete(focused: string) {
	return Changelog.autocomplete!({ options: { getFocused: () => focused } } as never, {} as never);
}

describe('CompareSemver', () => {
	// Bug: versions were sorted as text, which puts 5.10.0 below 5.9.0
	it.each([
		[ '5.10.0', '5.9.0'  ],
		[ '5.2.10', '5.2.9'  ],
		[ '10.0.0', '9.9.9'  ],
		[ '5.2.0' , '5.1.1'  ]
	])('ranks %s above %s', (newer, older) => {
		expect(CompareSemver(newer, older)).toBeGreaterThan(0);
		expect(CompareSemver(older, newer)).toBeLessThan(0);
	});

	it('treats equal versions as equal', () => {
		expect(CompareSemver('5.2.0', '5.2.0')).toBe(0);
	});

	it('sorts a list oldest first', () => {
		expect([ '5.10.0', '5.9.0', '4.0.3', '5.0.0' ].sort(CompareSemver)).toEqual([ '4.0.3', '5.0.0', '5.9.0', '5.10.0' ]);
	});
});

describe('/changelog', () => {
	it('LATEST_VERSION is the newest release, which is what no version shows', async () => {
		const versions = (await complete('')).length; // sanity: there is a changelog at all
		expect(versions).toBeGreaterThan(1);

		expect(embedOf(await changelog(null)).title).toBe(`Fox Box Insurance : v${LATEST_VERSION}`);
		expect(embedOf(await changelog('latest')).title).toBe(`Fox Box Insurance : v${LATEST_VERSION}`);
		// Every release of the newest major is at or below it
		for (const choice of await complete(LATEST_VERSION.split('.')[0])) {
			expect(CompareSemver(LATEST_VERSION, choice.value as string), choice.name).toBeGreaterThanOrEqual(0);
		}
	});

	/** The releases a major listing shows, in order, across all its embeds */
	async function listed(major: string): Promise<string[]> {
		const text = (screen(await changelog(`${major}.0`)).embeds ?? []).map(embed => embed.description).join('\n');
		return [ ...text.matchAll(/^\*\*(\d+\.\d+\.\d+)\*\*/gm) ].map(match => match[1]);
	}

	async function majors(): Promise<string[]> {
		return (await complete('')).filter(choice => choice.value !== 'latest').map(choice => (choice.value as string).split('.')[0]);
	}

	it('N.0 lists the releases of that major, newest first', async () => {
		const major = LATEST_VERSION.split('.')[0];
		const versions = await listed(major);

		expect(versions[0]).toBe(LATEST_VERSION);
		expect(versions).toEqual([ ...versions ].sort((a, b) => CompareSemver(b, a)));
		expect(versions.every(version => version.startsWith(`${major}.`))).toBe(true);
	});

	// Bug: a whole major went into one description - v5 is over 5000 chars, past Discord's 4096.
	// `changelog()` holds every listing to the limits; this pins what happens to the overflow
	it('every major listing fits Discord\'s limits, spilling into more embeds and naming what was left out', async () => {
		for (const major of await majors()) {
			const result = screen(await changelog(`${major}.0`));
			const releases = (await complete(`${major}.`)).length;
			const shown = (await listed(major)).length;
			const text = result.embeds!.map(embed => embed.description).join('\n');

			expect(result.embeds![0].title, major).toBe(`Fox Box Insurance : v${major}.x`);
			expect(shown, major).toBeGreaterThan(0);
			if (shown < releases) {
				expect(text, major).toContain(`${releases - shown} older release(s) not shown`);
			} else {
				expect(text, major).not.toContain('not shown');
			}
		}
	});

	it('v5 needs more than one embed today', async () => {
		expect(screen(await changelog('5.0')).embeds!.length).toBeGreaterThan(1);
	});

	it('every single release renders within limits', async () => {
		for (const major of await majors()) {
			for (const choice of await complete(`${major}.`)) {
				expect(embedOf(await changelog(choice.value as string)).title, choice.name).toBe(`Fox Box Insurance : v${choice.value}`);
			}
		}
	});

	// Bug: these returned `content` + `ephemeral: true` - not part of a handler response, and
	// editReply ignores `ephemeral`
	it.each([ '99.0', '1.2.3', 'banana' ])('answers %s with a not-found embed', async (version) => {
		const result = await changelog(version);

		expect(embedOf(result).color).toBe(COLOR.ERROR);
		expect(embedOf(result).description).toMatch(/No changelog found/);
		expect(result).not.toHaveProperty('content');
		expect(result).not.toHaveProperty('ephemeral');
	});
});

describe('/changelog - autocomplete', () => {
	// Bug: the majors were offered as `N.0.0`, which execute reads as one release - v2 has no 2.0.0, so
	// picking it answered "No changelog found", and the others showed a single release
	it('every choice offered before typing resolves to a changelog', async () => {
		const choices = await complete('');
		expect(choices[0]).toEqual({ name: 'Latest', value: 'latest' });

		for (const choice of choices) {
			expect(embedOf(await changelog(choice.value as string)).color, choice.name).toBe(COLOR.PRIMARY);
		}
	});

	it('a major choice lists that whole major', async () => {
		const major = (await complete('')).find(choice => choice.name === 'v2')!;
		expect(embedOf(await changelog(major.value as string)).title).toBe('Fox Box Insurance : v2.x');
	});

	it('typed input matches by prefix, with or without the v, oldest first and at most 25', async () => {
		const typed = await complete('5.0');

		expect(typed.length).toBeGreaterThan(1);
		expect(typed.length).toBeLessThanOrEqual(25);
		expect(typed.map(choice => choice.value)).toEqual(typed.map(choice => choice.value as string).sort(CompareSemver));
		expect(await complete('v5.0')).toEqual(typed);

		for (const choice of typed) {
			expect(embedOf(await changelog(choice.value as string)).title, choice.name).toBe(`Fox Box Insurance : v${choice.value}`);
		}
	});
});
