import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { APIModalInteractionResponseCallbackData } from 'discord-api-types/v10';
import { IClient } from '../../../Client.js';
import { ModalHandler, SelectMenuHandler } from '../../../Typings/HandlerTypes.js';
import { COLOR } from '../../../Utils/Constants.js';
import { CanonicalZone, CurrentTimeIn, ResolveTimezone, TIMEZONE_TABLE } from '../../../Utils/Timezones.js';
import {
	ExpectValidModal,
	ExpectValidResponse,
	HandlerResult,
	buttonsOf,
	customIDs,
	embedOf,
	makeClient,
	makeInteraction,
	screen,
	selectsOf
} from '../Helpers.js';
import { GUILD_ID, SPANS, SUMMER, USER_ID, argsOf } from './Fixtures.js';

/**
 * The timezone flow off the activity chart:
 * - `set-timezone` button - opens the modal
 * - `set-timezone` modal  - stores an exact match, otherwise asks (a menu) or explains (unknown)
 * - `pick-timezone` menu  - stores the zone picked from that menu
 *
 * Every screen carries the chart's span in its custom_id, so the user lands back on the chart they
 * left. What `ResolveTimezone` makes of an input is covered in `Tests/Timezones.test.ts` - here it's
 * what each outcome renders, and that nothing but an exact match is ever stored.
 */

const { query, zones, GetTimezone, SetTimezone, AggregateMessageHistory, renderDayRows, renderMonthView, renderYearView } = vi.hoisted(() => ({
	query                  : vi.fn(),
	/** Stored zones by user id */
	zones                  : new Map<string, string>(),
	GetTimezone            : vi.fn(),
	SetTimezone            : vi.fn(),
	AggregateMessageHistory: vi.fn(),
	renderDayRows          : vi.fn(),
	renderMonthView        : vi.fn(),
	renderYearView         : vi.fn()
}));
vi.mock('../../../Database.js', () => ({ Database: { query } }));
vi.mock('../../../CRUD/UserTimezones.js', () => ({ GetTimezone, SetTimezone }));
vi.mock('../../../Utils/Activity/AggregateMessageHistory.js', () => ({ AggregateMessageHistory }));
vi.mock('../../../Utils/Activity/render-day-rows.js', () => ({ renderDayRows }));
vi.mock('../../../Utils/Activity/render-month-view.js', () => ({ renderMonthView }));
vi.mock('../../../Utils/Activity/render-year-view.js', () => ({ renderYearView }));

const Activity = (await import('../../../Buttons/Activity.js')).default;
const TimezoneButton = (await import('../../../Buttons/SetTimezone.js')).default;
const TimezoneModal = (await import('../../../Modals/SetTimezone.js')).default;
const PickTimezone = (await import('../../../Menus/PickTimezone.js')).default;

const RENDERERS = { week: renderDayRows, month: renderMonthView, year: renderYearView };

/** Abbreviations more than one zone goes by - IST, CST, AST */
const AMBIGUOUS = [ ...new Set(TIMEZONE_TABLE.map(row => row.abbreviation)) ]
	.filter(abbreviation => TIMEZONE_TABLE.filter(row => row.abbreviation === abbreviation).length > 1);

let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: [ 'Date' ] });
	vi.setSystemTime(SUMMER);

	zones.clear();
	query.mockImplementation(async () => { throw new Error('unexpected query'); });
	GetTimezone.mockImplementation(async (id: string) => zones.get(String(id)) ?? 'UTC');
	SetTimezone.mockImplementation(async (id: string, zone: string) => { zones.set(String(id), zone); });
	AggregateMessageHistory.mockResolvedValue([]);
	for (const render of Object.values(RENDERERS)) render.mockReturnValue(Buffer.from('png'));

	client = await makeClient();
});

afterEach(() => {
	vi.useRealTimers();
});

async function open(args: string[]): Promise<APIModalInteractionResponseCallbackData> {
	const result = await TimezoneButton.execute(makeInteraction({ guildId: GUILD_ID, userId: USER_ID }), client, args);
	await ExpectValidModal(result);
	return result as APIModalInteractionResponseCallbackData;
}

async function submit(input: string, args: string[]): Promise<HandlerResult> {
	const sent = makeInteraction({ kind: 'modal', guildId: GUILD_ID, userId: USER_ID, fields: { data: input } });
	const result = await TimezoneModal.execute(sent as unknown as Parameters<ModalHandler['execute']>[0], client, args);
	await ExpectValidResponse(result, TimezoneModal);
	return result;
}

async function pick(values: string[], args: string[]): Promise<HandlerResult> {
	const sent = makeInteraction({ kind: 'menu', guildId: GUILD_ID, userId: USER_ID, values });
	const result = await PickTimezone.execute(sent as unknown as Parameters<SelectMenuHandler['execute']>[0], client, args);
	await ExpectValidResponse(result, PickTimezone);
	return result;
}

/** The chart for `span`: its renderer ran last, and its span button is the disabled one */
function expectChart(result: HandlerResult, span: keyof typeof RENDERERS, label: string): void {
	expect(RENDERERS[span]).toHaveBeenCalledTimes(1);
	expect(RENDERERS[span].mock.calls[0][0].timezone).toBe(label);

	const response = screen(result);
	expect(response.embeds).toEqual([]);
	expect(response.files).toHaveLength(1);
	expect(buttonsOf(result).filter(button => button.disabled && button.style === 3)).toHaveLength(1);
	expect(customIDs(result)).toContain(`set-timezone_${span}`);
	expect(buttonsOf(result).at(-1)!.label).toBe(`Timezone: ${label}`);
}

/** A screen that stored nothing: the chart image is dropped and the last row reopens the modal */
function expectPrompt(result: HandlerResult, span: string): void {
	// Without `files: []` history.png stays attached above the embed
	expect(screen(result).files).toEqual([]);
	expect(SetTimezone).not.toHaveBeenCalled();
	expect(zones.size).toBe(0);
	for (const render of Object.values(RENDERERS)) expect(render).not.toHaveBeenCalled();

	const last = screen(result).components!.at(-1)!.components;
	expect(last).toEqual([{ type: 2, label: 'Try again', custom_id: `set-timezone_${span}`, style: 2 }]);
}

describe('set-timezone button', () => {
	it.each(SPANS)('$span: opens a modal that submits back with the span', async ({ span }) => {
		const modal = await open([ span ]);

		expect(modal.custom_id).toBe(`set-timezone_${span}`);
		expect(modal.title).toBe('Set Your Timezone');
		expect(modal.components).toHaveLength(1);
	});

	it('prefills UTC for a user who never set a zone', async () => {
		const modal = await open([ 'week' ]);

		expect(modal.components[0]).toMatchObject({ components: [{ type: 4, custom_id: 'data', value: 'UTC', required: true }] });
	});

	it('prefills the current label, which the modal resolves straight back to the same zone', async () => {
		zones.set(USER_ID, 'America/New_York');

		const modal = await open([ 'week' ]);
		const value = (modal.components[0] as unknown as { components: { value: string }[] }).components[0].value;

		expect(value).toBe('EDT');
		expect(ResolveTimezone(value)).toEqual({ kind: 'resolved', zone: 'America/New_York' });
	});

	it('never queries the chart', async () => {
		await open([ 'week' ]);

		expect(AggregateMessageHistory).not.toHaveBeenCalled();
	});
});

describe('set-timezone modal - resolved', () => {
	it.each([
		[ 'JST', 'Asia/Tokyo', 'JST' ],
		[ ' est ', 'America/New_York', 'EDT' ],
		[ 'Europe/London', 'Europe/London', 'BST' ],
		[ 'UTC+2', 'Etc/GMT-2', 'UTC+2' ]
	])('%s stores %s and returns to the chart', async (input, zone, label) => {
		const result = await submit(input, [ 'month' ]);

		expect(SetTimezone).toHaveBeenCalledTimes(1);
		expect(SetTimezone).toHaveBeenCalledWith(USER_ID, CanonicalZone(zone));
		expectChart(result, 'month', label);
	});

	it.each(SPANS)('$span: re-renders the span it came from', async ({ span }) => {
		const result = await submit('JST', [ span ]);

		expectChart(result, span, 'JST');
	});
});

describe('set-timezone modal - ambiguous', () => {
	it('asks which zone, by the clock each one is showing', async () => {
		const result = await submit('ist', [ 'year' ]);

		expect(embedOf(result).title).toBe('Which IST do you mean?');
		expectPrompt(result, 'year');

		const [ select ] = selectsOf(result);
		expect(select.custom_id).toBe('pick-timezone_year');
		expect(select.options).toEqual([
			{ label: `IST — it's currently ${CurrentTimeIn('Asia/Kolkata', SUMMER)}`, description: 'India Standard Time', value: 'Asia/Kolkata' },
			{ label: `IST — it's currently ${CurrentTimeIn('Europe/Dublin', SUMMER)}`, description: 'Irish Standard Time', value: 'Europe/Dublin' },
			{ label: `IST — it's currently ${CurrentTimeIn('Asia/Jerusalem', SUMMER)}`, description: 'Israel Standard Time', value: 'Asia/Jerusalem' }
		]);
		// The whole point of the clock: no two candidates read the same
		expect(new Set(select.options.map(option => option.label)).size).toBe(3);
	});

	it('is the menu, then Try again - nothing else', async () => {
		const result = await submit('CST', [ 'week' ]);

		expect(screen(result).components).toHaveLength(2);
		expect(selectsOf(result)).toHaveLength(1);
		expect(buttonsOf(result)).toHaveLength(1);
	});

	it('covers every shared abbreviation in the table within Discord\'s limits', async () => {
		expect(AMBIGUOUS).toEqual(expect.arrayContaining([ 'IST', 'CST', 'AST' ]));

		for (const abbreviation of AMBIGUOUS) {
			// `submit` runs ExpectValidResponse: <= 25 options, unique values, text <= 100
			const result = await submit(abbreviation, [ 'week' ]);

			const expected = TIMEZONE_TABLE.filter(row => row.abbreviation === abbreviation).map(row => row.iana);
			expect(selectsOf(result)[0].options.map(option => option.value)).toEqual(expected);
			expectPrompt(result, 'week');
		}
	});
});

describe('set-timezone modal - suggestions', () => {
	it.each([
		[ 'a typo', 'ETS' ],
		[ 'a region phrase', 'Pacific' ],
		[ 'a near miss on a zone path', 'Europe/Londn' ]
	])('offers a menu without the clock for %s', async (_, input) => {
		const resolution = ResolveTimezone(input);
		if (resolution.kind !== 'suggestions') throw new Error(`expected '${input}' to produce suggestions, got ${resolution.kind}`);

		const result = await submit(input, [ 'month' ]);

		expect(embedOf(result).title).toBe('Did you mean one of these?');
		expect(embedOf(result).description).toContain(`**${input}**`);
		expectPrompt(result, 'month');

		const [ select ] = selectsOf(result);
		expect(select.custom_id).toBe('pick-timezone_month');
		expect(select.options).toEqual(resolution.candidates.map(candidate => ({
			label: `${candidate.abbreviation} — ${candidate.region}`,
			value: candidate.iana
		})));
	});

	it('suggests the zone a path typo was aiming at', async () => {
		const result = await submit('Europe/Londn', [ 'week' ]);

		expect(selectsOf(result)[0].options.map(option => option.value)).toContain('Europe/London');
	});
});

describe('set-timezone modal - unknown', () => {
	it('explains what can be entered and offers Try again', async () => {
		const result = await submit('zzzzzz', [ 'year' ]);

		expect(embedOf(result)).toMatchObject({ color: COLOR.ERROR, title: 'Unknown timezone' });
		expect(embedOf(result).description).toContain('**zzzzzz**');
		expect(screen(result).components).toHaveLength(1);
		expectPrompt(result, 'year');
	});

	it('does not quote blank input back', async () => {
		const result = await submit('   ', [ 'week' ]);

		expect(embedOf(result).description).toContain('**that**');
		expectPrompt(result, 'week');
	});

	it('refuses a half hour offset rather than rounding it', async () => {
		const result = await submit('UTC+5:30', [ 'week' ]);

		expect(embedOf(result).title).toBe('Unknown timezone');
		expectPrompt(result, 'week');
	});
});

describe('set-timezone modal - span', () => {
	it.each([
		[ 'an unknown span', [ 'decade' ] ],
		[ 'no span', [] ]
	])('throws on %s before storing a perfectly good zone', async (_, args) => {
		const sent = makeInteraction({ kind: 'modal', fields: { data: 'JST' } });

		await expect(TimezoneModal.execute(sent as unknown as Parameters<ModalHandler['execute']>[0], client, args))
			.rejects.toThrow('Invalid time interval');
		expect(SetTimezone).not.toHaveBeenCalled();
	});
});

describe('pick-timezone', () => {
	it.each(SPANS)('$span: stores the picked zone and returns to the chart', async ({ span }) => {
		const result = await pick([ 'Asia/Jerusalem' ], [ span ]);

		expect(SetTimezone).toHaveBeenCalledTimes(1);
		expect(SetTimezone).toHaveBeenCalledWith(USER_ID, CanonicalZone('Asia/Jerusalem'));
		// Israel is on daylight saving in July, but the table only has the one name for it
		expectChart(result, span, 'IST');
	});

	it('accepts every value an abbreviation menu can offer', async () => {
		// Includes 'UTC', the one zone with no '/' in it
		for (const { iana } of TIMEZONE_TABLE) {
			SetTimezone.mockClear();
			await pick([ iana ], [ 'week' ]);

			expect(SetTimezone, iana).toHaveBeenCalledWith(USER_ID, CanonicalZone(iana));
		}
	});

	it('accepts every value a zone path menu can offer', async () => {
		const suggestions = selectsOf(await submit('Europe/Londn', [ 'week' ]))[0].options;
		expect(suggestions.length).toBeGreaterThan(0);

		for (const { value } of suggestions) {
			SetTimezone.mockClear();
			await pick([ value ], [ 'week' ]);

			expect(SetTimezone, value).toHaveBeenCalledWith(USER_ID, CanonicalZone(value));
		}
	});

	it.each([
		[ 'a zone that does not exist', [ 'Not/AZone' ] ],
		[ 'an abbreviation that is itself ambiguous', [ 'IST' ] ],
		[ 'an empty value', [ '' ] ],
		[ 'no value', [] ]
	])('refuses %s, dropping the dead menu and the chart', async (_, values) => {
		const result = await pick(values, [ 'month' ]);

		expect(embedOf(result)).toMatchObject({ color: COLOR.ERROR, title: 'Unknown timezone' });
		expect(selectsOf(result)).toHaveLength(0);
		expect(screen(result).components).toHaveLength(1);
		expectPrompt(result, 'month');
	});

	it.each([
		[ 'an unknown span', [ 'decade' ] ],
		[ 'no span', [] ]
	])('throws on %s before storing', async (_, args) => {
		const sent = makeInteraction({ kind: 'menu', values: [ 'Asia/Tokyo' ] });

		await expect(PickTimezone.execute(sent as unknown as Parameters<SelectMenuHandler['execute']>[0], client, args))
			.rejects.toThrow('Invalid time interval');
		expect(SetTimezone).not.toHaveBeenCalled();
	});
});

describe('round trip', () => {
	it.each(SPANS)('$span: chart -> Timezone -> modal -> menu -> the same chart, in the new zone', async ({ span, days }) => {
		// Each step takes its args from the custom_id the step before rendered, as GlobalHandler would
		const chart = await Activity.execute(makeInteraction({ guildId: GUILD_ID, userId: USER_ID }), client, [ span ]);
		const timezoneButton = customIDs(chart).at(-1)!;
		expect(timezoneButton).toBe(`set-timezone_${span}`);

		const modal = await open(argsOf(timezoneButton));
		const prompt = await submit('IST', argsOf(modal.custom_id));

		const [ select ] = selectsOf(prompt);
		expect(select.options.map(option => option.value)).toContain('Asia/Kolkata');

		for (const render of Object.values(RENDERERS)) render.mockClear();
		const result = await pick([ 'Asia/Kolkata' ], argsOf(select.custom_id));

		expect(zones.get(USER_ID)).toBe(CanonicalZone('Asia/Kolkata'));
		expectChart(result, span, 'IST');
		expect(RENDERERS[span].mock.calls[0][0].days).toHaveLength(days);

		// ...and the modal now opens on what they picked
		expect((await open([ span ])).components[0]).toMatchObject({ components: [{ value: 'IST' }] });
	});

	it('Try again on a dead end reopens the modal for the same span', async () => {
		const dead = await submit('zzzzzz', [ 'year' ]);

		const modal = await open(argsOf(customIDs(dead)[0]));

		expect(modal.custom_id).toBe('set-timezone_year');
	});
});
