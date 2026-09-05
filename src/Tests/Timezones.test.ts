import { describe, expect, it } from "vitest";
import {
	CanonicalZone,
	CurrentTimeIn,
	ResolveTimezone,
	TimezoneLabel,
	TIMEZONE_TABLE,
	TimezoneResolution
} from "../Utils/Timezones.js";

/** Mid January and mid July 2026, so the two sides of a daylight saving year are both covered */
const WINTER = Date.UTC(2026, 0, 15, 12);
const SUMMER = Date.UTC(2026, 6, 15, 12);

function ExpectResolved(input: string, zone: string): void {
	const resolution = ResolveTimezone(input);
	expect(resolution, `${input} should resolve`).toMatchObject({ kind: 'resolved', zone });
}

function Candidates(resolution: TimezoneResolution): string[] {
	if (resolution.kind !== 'ambiguous' && resolution.kind !== 'suggestions') return [];
	return resolution.candidates.map(candidate => candidate.iana);
}

describe('ResolveTimezone - abbreviations', () => {
	it('resolves an unambiguous abbreviation', () => {
		ExpectResolved('EST', 'America/New_York');
		ExpectResolved('JST', 'Asia/Tokyo');
		ExpectResolved('NZDT', 'Pacific/Auckland');
	});

	it('resolves the daylight spelling to the same zone as the standard one', () => {
		ExpectResolved('EDT', 'America/New_York');
		ExpectResolved('BST', 'Europe/London');
	});

	it('ignores case and surrounding whitespace', () => {
		ExpectResolved('  est  ', 'America/New_York');
		ExpectResolved('Jst', 'Asia/Tokyo');
	});

	it('reports shared abbreviations as ambiguous instead of guessing', () => {
		const cst = ResolveTimezone('CST');
		expect(cst.kind).toBe('ambiguous');
		expect(Candidates(cst)).toEqual(['America/Chicago', 'Asia/Shanghai']);

		const ist = ResolveTimezone('IST');
		expect(ist.kind).toBe('ambiguous');
		expect(Candidates(ist)).toEqual(['Asia/Kolkata', 'Europe/Dublin', 'Asia/Jerusalem']);

		const ast = ResolveTimezone('AST');
		expect(ast.kind).toBe('ambiguous');
		expect(Candidates(ast)).toEqual(['America/Halifax', 'Asia/Riyadh']);
	});
});

describe('ResolveTimezone - typos and phrases', () => {
	it('suggests the intended abbreviation for a transposition', () => {
		const resolution = ResolveTimezone('ETS');
		expect(resolution.kind).toBe('suggestions');
		expect(Candidates(resolution)).toContain('America/New_York');
	});

	it('suggests for an extra character', () => {
		const resolution = ResolveTimezone('PSTT');
		expect(resolution.kind).toBe('suggestions');
		expect(Candidates(resolution)).toContain('America/Los_Angeles');
	});

	it('matches a region phrase that is nothing like an abbreviation', () => {
		expect(Candidates(ResolveTimezone('China'))).toContain('Asia/Shanghai');
		expect(Candidates(ResolveTimezone('Pacific'))).toContain('America/Los_Angeles');
	});

	it('offers each zone only once, not under both its names', () => {
		const zones = Candidates(ResolveTimezone('ETS'));
		expect(zones.length).toBe(new Set(zones).size);
	});

	it('gives up rather than suggesting nonsense', () => {
		expect(ResolveTimezone('XQZP').kind).toBe('unknown');
		expect(ResolveTimezone('').kind).toBe('unknown');
		expect(ResolveTimezone('   ').kind).toBe('unknown');
	});

	it('never returns more candidates than a select menu can hold', () => {
		for (const input of ['ETS', 'PSTT', 'China', 'Pacific', 'Time', 'ST']) {
			const resolution = ResolveTimezone(input);
			expect(Candidates(resolution).length).toBeLessThanOrEqual(25);
		}
	});
});

describe('ResolveTimezone - UTC offsets', () => {
	/** How far ahead of UTC a zone actually is, read back out of ICU rather than off the zone name */
	function OffsetHours(zone: string): number {
		const label = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
			.formatToParts(WINTER)
			.find(part => part.type === 'timeZoneName')!.value;

		const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(label);
		if (!match) return 0;

		const magnitude = Number(match[2]) + Number(match[3]) / 60;
		return match[1] === '-' ? -magnitude : magnitude;
	}

	it('puts a negative offset behind UTC despite the Etc sign inversion', () => {
		const resolution = ResolveTimezone('UTC-5');
		expect(resolution.kind).toBe('resolved');
		if (resolution.kind !== 'resolved') return;

		// The literal name is Etc/GMT+5; what matters is that the clock is five hours behind
		expect(OffsetHours(resolution.zone)).toBe(-5);
	});

	it('puts a positive offset ahead of UTC', () => {
		for (const input of ['UTC+8', 'GMT+8', '+8', '+08:00']) {
			const resolution = ResolveTimezone(input);
			expect(resolution.kind, input).toBe('resolved');
			if (resolution.kind !== 'resolved') continue;
			expect(OffsetHours(resolution.zone), input).toBe(8);
		}
	});

	it('treats a zero offset as UTC', () => {
		ExpectResolved('UTC+0', 'UTC');
		ExpectResolved('-0', 'UTC');
	});

	it('rejects half hour offsets, which have no Etc zone', () => {
		expect(ResolveTimezone('+5:30').kind).not.toBe('resolved');
		expect(ResolveTimezone('UTC+05:30').kind).not.toBe('resolved');
	});

	it('rejects offsets beyond the real range', () => {
		expect(ResolveTimezone('+20').kind).not.toBe('resolved');
	});
});

describe('ResolveTimezone - IANA names', () => {
	it('accepts a zone name as typed', () => {
		ExpectResolved('Europe/London', 'Europe/London');
		ExpectResolved('Etc/UTC', 'UTC');
	});

	it('accepts an alias, canonicalised to the zone it links to', () => {
		// tzdata links this to America/Buenos_Aires, and supportedValuesOf never mentions it
		const resolution = ResolveTimezone('America/Argentina/Buenos_Aires');
		expect(resolution.kind).toBe('resolved');
		if (resolution.kind !== 'resolved') return;
		expect(CurrentTimeIn(resolution.zone, WINTER)).toBe(CurrentTimeIn('America/Argentina/Buenos_Aires', WINTER));
	});

	it('does not let a bare abbreviation reach ICU as a zone name', () => {
		// ICU accepts "EST" and "GMT+8" as zones; the abbreviation table and offset parser own those
		expect(ResolveTimezone('EST')).toMatchObject({ kind: 'resolved', zone: 'America/New_York' });
	});

	it('accepts a zone name in any case', () => {
		ExpectResolved('america/new_york', 'America/New_York');
		ExpectResolved('EUROPE/PARIS', 'Europe/Paris');
	});

	it('accepts spaces where the zone name has underscores', () => {
		ExpectResolved('america/new york', 'America/New_York');
		ExpectResolved('America / New York', 'America/New_York');
		ExpectResolved('Australia / Broken Hill', 'Australia/Broken_Hill');
	});

	it('leaves hyphenated zone names alone', () => {
		ExpectResolved('America/Port-au-Prince', 'America/Port-au-Prince');
	});

	it('suggests zones for a near miss on a path', () => {
		const resolution = ResolveTimezone('Europe/Londn');
		expect(resolution.kind).toBe('suggestions');
		expect(Candidates(resolution)).toContain('Europe/London');
	});

	it('rejects a zone that does not exist', () => {
		expect(ResolveTimezone('Not/AZone').kind).not.toBe('resolved');
		expect(ResolveTimezone('completely/madeup').kind).toBe('unknown');
	});
});

describe('TimezoneLabel', () => {
	it('follows daylight saving in the northern hemisphere', () => {
		expect(TimezoneLabel('America/New_York', WINTER)).toBe('EST');
		expect(TimezoneLabel('America/New_York', SUMMER)).toBe('EDT');
		expect(TimezoneLabel('Europe/London', WINTER)).toBe('GMT');
		expect(TimezoneLabel('Europe/London', SUMMER)).toBe('BST');
	});

	it('follows daylight saving in the southern hemisphere, where the seasons are reversed', () => {
		expect(TimezoneLabel('Australia/Sydney', WINTER)).toBe('AEDT');
		expect(TimezoneLabel('Australia/Sydney', SUMMER)).toBe('AEST');
	});

	it('leaves zones without daylight saving alone', () => {
		expect(TimezoneLabel('Asia/Kolkata', WINTER)).toBe('IST');
		expect(TimezoneLabel('Asia/Kolkata', SUMMER)).toBe('IST');
		expect(TimezoneLabel('Etc/UTC', SUMMER)).toBe('UTC');
	});

	it('falls back to an offset for zones with no abbreviation of their own', () => {
		expect(TimezoneLabel('Etc/GMT+5', WINTER)).toBe('UTC-5');
		expect(TimezoneLabel('Asia/Kathmandu', WINTER)).toBe('UTC+5:45');
	});

	it('round trips: every label a user is shown resolves back to a zone', () => {
		for (const zone of new Set(TIMEZONE_TABLE.map(candidate => candidate.iana))) {
			for (const timestamp of [WINTER, SUMMER]) {
				const label = TimezoneLabel(zone, timestamp);
				expect(ResolveTimezone(label).kind, `${zone} shows ${label}`).not.toBe('unknown');
			}
		}
	});
});

describe('TIMEZONE_TABLE', () => {
	it('only names zones that actually exist', () => {
		for (const candidate of TIMEZONE_TABLE) {
			expect(CanonicalZone(candidate.iana), `${candidate.abbreviation} -> ${candidate.iana}`).not.toBeNull();
		}
	});

	it('has at most one standard and one daylight row per zone', () => {
		const seen = new Map<string, number>();
		for (const candidate of TIMEZONE_TABLE) {
			const key = `${candidate.iana}:${candidate.daylight ? 'dst' : 'std'}`;
			seen.set(key, (seen.get(key) ?? 0) + 1);
		}

		for (const [key, count] of seen) expect(count, key).toBe(1);
	});

	it('never lists the same abbreviation against one zone twice', () => {
		const pairs = TIMEZONE_TABLE.map(candidate => `${candidate.abbreviation}:${candidate.iana}`);
		expect(pairs.length).toBe(new Set(pairs).size);
	});
});

describe('CurrentTimeIn', () => {
	it('renders a wall clock time for the zone', () => {
		expect(CurrentTimeIn('Etc/UTC', WINTER)).toBe('12:00 PM');
		expect(CurrentTimeIn('Asia/Tokyo', WINTER)).toBe('9:00 PM');
		expect(CurrentTimeIn('America/New_York', WINTER)).toBe('7:00 AM');
	});
});
