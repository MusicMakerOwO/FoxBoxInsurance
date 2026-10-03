import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { SECONDS } from '../../../Utils/Constants.js';
import { ZonedDayStarts } from '../../../Utils/ZonedTime.js';
import { ExpectValidResponse, HandlerResult, buttonsOf, customIDs, makeClient, makeInteraction, screen } from '../Helpers.js';
import { GUILD_ID, SPANS, SUMMER, USER_ID, WINTER } from './Fixtures.js';

/**
 * `activity` - the message history chart, as a week, month or year in the user's own timezone.
 * `/activity` delegates to it with `week`.
 *
 * Its gates (the same as `/activity`) are pinned in `Handlers/Registry.test.ts`.
 *
 * The renderers are spies, so no canvas work happens here - what matters is what they are asked to
 * draw. The clock is pinned so the day windows and the EST / EDT style labels are deterministic.
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
const ActivityCommand = (await import('../../../Commands/Activity.js')).default;

const RENDERERS = { week: renderDayRows, month: renderMonthView, year: renderYearView };
const IMAGE = Buffer.from('png');

let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: [ 'Date' ] });
	vi.setSystemTime(SUMMER);

	zones.clear();
	query.mockImplementation(async () => { throw new Error('unexpected query'); });
	GetTimezone.mockImplementation(async (id: string) => zones.get(String(id)) ?? 'UTC');
	AggregateMessageHistory.mockResolvedValue([]);
	for (const render of Object.values(RENDERERS)) render.mockReturnValue(IMAGE);

	client = await makeClient();
});

afterEach(() => {
	vi.useRealTimers();
});

async function click(args: string[]): Promise<HandlerResult> {
	const result = await Activity.execute(makeInteraction({ guildId: GUILD_ID, userId: USER_ID }), client, args);
	await ExpectValidResponse(result, Activity);
	return result;
}

describe('activity - span', () => {
	it.each([
		[ 'an unknown span', [ 'decade' ] ],
		[ 'an empty span', [ '' ] ],
		[ 'no span at all', [] ],
		[ 'a span in the wrong case', [ 'Week' ] ]
	])('throws on %s before reading anything', async (_, args) => {
		await expect(Activity.execute(makeInteraction(), client, args)).rejects.toThrow('Invalid time interval');

		expect(GetTimezone).not.toHaveBeenCalled();
		expect(AggregateMessageHistory).not.toHaveBeenCalled();
	});

	it.each(SPANS)('$span queries $days local days in the user\'s zone', async ({ span, days }) => {
		zones.set(USER_ID, 'America/Chicago');

		await click([ span ]);

		expect(AggregateMessageHistory).toHaveBeenCalledTimes(1);
		expect(AggregateMessageHistory).toHaveBeenCalledWith({
			guildID   : BigInt(GUILD_ID),
			channelID : null,
			// Local midnight in Chicago, not UTC midnight
			timeRange : [ ZonedDayStarts('America/Chicago', SUMMER, days)[0], SUMMER ],
			bucketSize: SECONDS.HOUR
		});
		expect(ZonedDayStarts('America/Chicago', SUMMER, days)[0]).not.toBe(ZonedDayStarts('UTC', SUMMER, days)[0]);
	});

	it.each(SPANS)('$span draws $days days with its own renderer', async ({ span, days }) => {
		await click([ span ]);

		for (const [ name, render ] of Object.entries(RENDERERS)) {
			expect(render).toHaveBeenCalledTimes(name === span ? 1 : 0);
		}
		expect(RENDERERS[span].mock.calls[0][0].days).toHaveLength(days);
	});

	it('names the server and its initials on the chart', async () => {
		await click([ 'week' ]);

		expect(renderDayRows.mock.calls[0][0]).toMatchObject({ serverName: 'Test Guild', initials: 'TE' });
	});

	it('labels the week\'s rows with local calendar days', async () => {
		// 12:00 UTC on Wed 15 Jul is already Thu 16 Jul in Auckland
		vi.setSystemTime(Date.UTC(2026, 6, 15, 12));
		zones.set(USER_ID, 'Pacific/Auckland');

		await click([ 'week' ]);

		const days = renderDayRows.mock.calls[0][0].days as { name: string, date: string }[];
		expect(days.at(-1)).toMatchObject({ name: 'Thursday', date: '16 Jul' });
		expect(days[0]).toMatchObject({ name: 'Friday', date: '10 Jul' });
	});
});

describe('activity - timezone label', () => {
	it('defaults to UTC for a user who never set one', async () => {
		const result = await click([ 'week' ]);

		expect(renderDayRows.mock.calls[0][0].timezone).toBe('UTC');
		expect(buttonsOf(result).at(-1)!.label).toBe('Timezone: UTC');
	});

	it('follows daylight saving at the time of the click', async () => {
		zones.set(USER_ID, 'America/Chicago');

		const summer = await click([ 'month' ]);
		expect(renderMonthView.mock.calls[0][0].timezone).toBe('CDT');
		expect(buttonsOf(summer).at(-1)!.label).toBe('Timezone: CDT');

		vi.setSystemTime(WINTER);
		const winter = await click([ 'month' ]);
		expect(renderMonthView.mock.calls[1][0].timezone).toBe('CST');
		expect(buttonsOf(winter).at(-1)!.label).toBe('Timezone: CST');
	});

	it('falls back to an offset for a zone with no abbreviation', async () => {
		zones.set(USER_ID, 'Asia/Kathmandu');

		const result = await click([ 'year' ]);

		expect(renderYearView.mock.calls[0][0].timezone).toBe('UTC+5:45');
		expect(buttonsOf(result).at(-1)!.label).toBe('Timezone: UTC+5:45');
	});
});

describe('activity - response', () => {
	it('is the image alone: no embeds, one history.png, one button row', async () => {
		const response = screen(await click([ 'week' ]));

		// `embeds: []` clears whatever screen the chart replaces (the timezone prompts)
		expect(response.embeds).toEqual([]);
		expect(response.files).toEqual([{ attachment: IMAGE, name: 'history.png' }]);
		expect(response.components).toHaveLength(1);
		expect(Object.keys(response).sort()).toEqual([ 'components', 'embeds', 'files' ]);
	});

	it.each(SPANS)('$span: its own button is SUCCESS + disabled, the others SECONDARY', async ({ span }) => {
		const result = await click([ span ]);

		for (const other of SPANS) {
			const button = buttonsOf(result).find(button => 'custom_id' in button && button.custom_id === `activity_${other.span}`)!;
			expect(button.style).toBe(other.span === span ? 3 : 2);
			expect(Boolean(button.disabled)).toBe(other.span === span);
		}
	});

	it.each(SPANS)('$span: the Timezone button carries the span', async ({ span }) => {
		const result = await click([ span ]);

		expect(customIDs(result)).toEqual([ 'activity_year', 'activity_month', 'activity_week', 'null', `set-timezone_${span}` ]);
		expect(buttonsOf(result).at(-1)!.disabled).toBeFalsy();
	});
});

describe('/activity', () => {
	it('renders the week chart', async () => {
		const result = await ActivityCommand.execute(makeInteraction({ guildId: GUILD_ID, userId: USER_ID }) as never, client);
		await ExpectValidResponse(result as HandlerResult, ActivityCommand);

		expect(renderDayRows).toHaveBeenCalledTimes(1);
		expect(customIDs(result as HandlerResult)).toContain('set-timezone_week');
	});
});
