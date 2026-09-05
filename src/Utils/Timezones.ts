/**
 * Resolving what a user typed into an IANA zone.
 *
 * Users think in abbreviations - "EST", "CST" - and asking for a country or a city to disambiguate is
 * more than this bot needs to know. So the abbreviation is the input *and* the display, and everything
 * here exists to turn one into a zone without ever asking where someone lives.
 *
 * Two things make that harder than a lookup table:
 *
 * - Abbreviations are not unique. CST is US Central *and* China Standard; IST is India, Ireland and
 *   Israel. `ResolveTimezone` reports those as `ambiguous` rather than guessing, and the caller asks
 *   the user which of the candidates matches the clock they are already looking at.
 * - Typos used to resolve to UTC in silence. Anything unrecognised now comes back as `suggestions` or
 *   `unknown`, and nothing is saved until the user confirms.
 *
 * The table below is hand written on purpose. ICU only knows US style abbreviations - asking
 * `Intl.DateTimeFormat` for a `short` timeZoneName gives "GMT+8" for Asia/Shanghai and "GMT+5:30" for
 * Asia/Kolkata, and yields 16 abbreviations across all 400+ zones - so it cannot generate this. ICU is
 * used for what it is good at instead: validating zone names, offsets, and rendering local times.
 */

import { ZoneOffset } from "./ZonedTime.js";

export interface TimezoneCandidate {
	/** What the user types and what they are shown back, ie 'CST' */
	abbreviation: string;
	/** IANA zone, ie 'America/Chicago' */
	iana: string;
	/** Only used to describe a candidate in a "did you mean" list, never asked for as input */
	region: string;
	/** The daylight saving side of a pair, ie EDT to EST's standard time */
	daylight?: boolean;
}

/**
 * One row per (abbreviation, zone) pair, so a shared abbreviation is representable rather than
 * arbitrarily resolved to whichever zone was listed first.
 */
export const TIMEZONE_TABLE: readonly TimezoneCandidate[] = [
	{ abbreviation: 'UTC', iana: 'UTC', region: 'Coordinated Universal Time' },

	{ abbreviation: 'EST', iana: 'America/New_York', region: 'Eastern Time (US & Canada)' },
	{ abbreviation: 'EDT', iana: 'America/New_York', region: 'Eastern Time (US & Canada)', daylight: true },
	{ abbreviation: 'CST', iana: 'America/Chicago', region: 'Central Time (US & Canada)' },
	{ abbreviation: 'CDT', iana: 'America/Chicago', region: 'Central Time (US & Canada)', daylight: true },
	{ abbreviation: 'MST', iana: 'America/Denver', region: 'Mountain Time (US & Canada)' },
	{ abbreviation: 'MDT', iana: 'America/Denver', region: 'Mountain Time (US & Canada)', daylight: true },
	{ abbreviation: 'PST', iana: 'America/Los_Angeles', region: 'Pacific Time (US & Canada)' },
	{ abbreviation: 'PDT', iana: 'America/Los_Angeles', region: 'Pacific Time (US & Canada)', daylight: true },
	{ abbreviation: 'AKST', iana: 'America/Anchorage', region: 'Alaska Time' },
	{ abbreviation: 'AKDT', iana: 'America/Anchorage', region: 'Alaska Time', daylight: true },
	{ abbreviation: 'HST', iana: 'Pacific/Honolulu', region: 'Hawaii Time' },
	{ abbreviation: 'AST', iana: 'America/Halifax', region: 'Atlantic Time (Canada)' },
	{ abbreviation: 'ADT', iana: 'America/Halifax', region: 'Atlantic Time (Canada)', daylight: true },
	{ abbreviation: 'NST', iana: 'America/St_Johns', region: 'Newfoundland Time' },
	{ abbreviation: 'NDT', iana: 'America/St_Johns', region: 'Newfoundland Time', daylight: true },

	// GMT resolves to London rather than Etc/UTC: the two are the same clock in winter, and someone
	// typing GMT in July almost certainly wants the UK, where it is BST
	{ abbreviation: 'GMT', iana: 'Europe/London', region: 'Greenwich Mean Time (United Kingdom)' },
	{ abbreviation: 'BST', iana: 'Europe/London', region: 'British Summer Time', daylight: true },
	{ abbreviation: 'CET', iana: 'Europe/Paris', region: 'Central European Time' },
	{ abbreviation: 'CEST', iana: 'Europe/Paris', region: 'Central European Summer Time', daylight: true },
	{ abbreviation: 'EET', iana: 'Europe/Helsinki', region: 'Eastern European Time' },
	{ abbreviation: 'EEST', iana: 'Europe/Helsinki', region: 'Eastern European Summer Time', daylight: true },
	{ abbreviation: 'WET', iana: 'Europe/Lisbon', region: 'Western European Time' },
	{ abbreviation: 'WEST', iana: 'Europe/Lisbon', region: 'Western European Summer Time', daylight: true },
	{ abbreviation: 'MSK', iana: 'Europe/Moscow', region: 'Moscow Time' },

	{ abbreviation: 'IST', iana: 'Asia/Kolkata', region: 'India Standard Time' },
	{ abbreviation: 'IST', iana: 'Europe/Dublin', region: 'Irish Standard Time' },
	{ abbreviation: 'IST', iana: 'Asia/Jerusalem', region: 'Israel Standard Time' },
	{ abbreviation: 'JST', iana: 'Asia/Tokyo', region: 'Japan Standard Time' },
	{ abbreviation: 'KST', iana: 'Asia/Seoul', region: 'Korea Standard Time' },
	{ abbreviation: 'CST', iana: 'Asia/Shanghai', region: 'China Standard Time' },
	{ abbreviation: 'AST', iana: 'Asia/Riyadh', region: 'Arabia Standard Time' },
	{ abbreviation: 'SGT', iana: 'Asia/Singapore', region: 'Singapore Time' },
	{ abbreviation: 'HKT', iana: 'Asia/Hong_Kong', region: 'Hong Kong Time' },
	{ abbreviation: 'PKT', iana: 'Asia/Karachi', region: 'Pakistan Standard Time' },
	{ abbreviation: 'WIB', iana: 'Asia/Jakarta', region: 'Western Indonesia Time' },
	{ abbreviation: 'PHT', iana: 'Asia/Manila', region: 'Philippine Time' },
	{ abbreviation: 'ICT', iana: 'Asia/Bangkok', region: 'Indochina Time' },
	{ abbreviation: 'GST', iana: 'Asia/Dubai', region: 'Gulf Standard Time' },

	{ abbreviation: 'AEST', iana: 'Australia/Sydney', region: 'Australian Eastern Time' },
	{ abbreviation: 'AEDT', iana: 'Australia/Sydney', region: 'Australian Eastern Time', daylight: true },
	{ abbreviation: 'ACST', iana: 'Australia/Adelaide', region: 'Australian Central Time' },
	{ abbreviation: 'ACDT', iana: 'Australia/Adelaide', region: 'Australian Central Time', daylight: true },
	{ abbreviation: 'AWST', iana: 'Australia/Perth', region: 'Australian Western Time' },
	{ abbreviation: 'NZST', iana: 'Pacific/Auckland', region: 'New Zealand Time' },
	{ abbreviation: 'NZDT', iana: 'Pacific/Auckland', region: 'New Zealand Time', daylight: true },

	{ abbreviation: 'BRT', iana: 'America/Sao_Paulo', region: 'Brasilia Time' },
	{ abbreviation: 'ART', iana: 'America/Argentina/Buenos_Aires', region: 'Argentina Time' },
	{ abbreviation: 'CLT', iana: 'America/Santiago', region: 'Chile Time' },
	{ abbreviation: 'COT', iana: 'America/Bogota', region: 'Colombia Time' },

	{ abbreviation: 'WAT', iana: 'Africa/Lagos', region: 'West Africa Time' },
	{ abbreviation: 'CAT', iana: 'Africa/Johannesburg', region: 'Central & Southern Africa Time' },
	{ abbreviation: 'EAT', iana: 'Africa/Nairobi', region: 'East Africa Time' },
] as const;

/**
 * The zone assumed for anyone who has never set one.
 *
 * `UTC` rather than `Etc/UTC` because that is what ICU canonicalises both to, and every zone that goes
 * through `CanonicalZone` comes out in that spelling. Rows written before this - which stored
 * `Etc/UTC` - still work, they just take the canonicalisation path on the way back out.
 */
export const DEFAULT_TIMEZONE = 'UTC';

export type TimezoneResolution =
	/** The input named exactly one zone */
	| { kind: 'resolved'; zone: string }
	/** A real abbreviation, but several places use it - ask which clock the user is on */
	| { kind: 'ambiguous'; input: string; candidates: TimezoneCandidate[] }
	/** Not recognised, but close to something that is - offer those */
	| { kind: 'suggestions'; input: string; candidates: TimezoneCandidate[] }
	/** Nothing close enough to offer */
	| { kind: 'unknown'; input: string };

/** Discord allows at most 25 options in a select menu */
const MAX_CANDIDATES = 25;
/** How many distinct abbreviations a "did you mean" list draws from */
const MAX_SUGGESTED_ABBREVIATIONS = 5;

const BY_ABBREVIATION = new Map<string, TimezoneCandidate[]>();
for (const candidate of TIMEZONE_TABLE) {
	const existing = BY_ABBREVIATION.get(candidate.abbreviation);
	if (existing) existing.push(candidate);
	else BY_ABBREVIATION.set(candidate.abbreviation, [candidate]);
}

/**
 * Table rows keyed by canonical zone, so a zone stored under an alias still finds its abbreviation.
 * Populated lazily, on the first `TimezoneLabel` call, to keep module load free of ICU work.
 */
let BY_ZONE: Map<string, TimezoneCandidate[]> | null = null;

const CANONICAL_ZONES = new Map<string, string | null>();

/**
 * Validates a zone name and returns ICU's canonical spelling of it, or null if it is not a zone.
 *
 * Asking ICU to build a formatter is the only complete check available. `supportedValuesOf` lists
 * neither aliases (`America/Argentina/Buenos_Aires`, which tzdata links to `America/Buenos_Aires`) nor
 * any of the `Etc/GMT±N` zones offsets resolve to, so a membership test against it rejects perfectly
 * valid input.
 *
 * Canonicalising rather than echoing the input back means one zone has one spelling everywhere - in
 * the database, in `TIMEZONE_TABLE` lookups, and between a user who typed `Etc/UTC` and one who typed
 * `UTC`. Results are memoised because constructing a formatter is not cheap and the same handful of
 * zones come round repeatedly.
 */
export function CanonicalZone(zone: string): string | null {
	const key = zone.toLowerCase();
	if (CANONICAL_ZONES.has(key)) return CANONICAL_ZONES.get(key)!;

	let canonical: string | null;
	try {
		canonical = new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
	} catch {
		// RangeError - ICU does not know this zone
		canonical = null;
	}

	CANONICAL_ZONES.set(key, canonical);
	return canonical;
}

const CLOCK_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/**
 * The wall clock time in a zone right now, ie "12:14 PM".
 *
 * This is what disambiguation is phrased in terms of: a user recognises their own clock without having
 * to tell us their country.
 */
export function CurrentTimeIn(zone: string, timestamp: number = Date.now()): string {
	let formatter = CLOCK_FORMATTERS.get(zone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
		CLOCK_FORMATTERS.set(zone, formatter);
	}

	return formatter.format(new Date(timestamp));
}

/** A `UTC+5:30` style label, for zones with no abbreviation of their own. */
function OffsetLabel(zone: string, timestamp: number): string {
	let offset: number;
	try {
		offset = ZoneOffset(zone, timestamp);
	} catch {
		return 'UTC';
	}

	if (offset === 0) return 'UTC';

	const minutes = Math.abs(offset) / 60_000;
	const hours = Math.floor(minutes / 60);
	const remainder = minutes % 60;

	return `UTC${offset < 0 ? '-' : '+'}${hours}${remainder ? `:${String(remainder).padStart(2, '0')}` : ''}`;
}

/**
 * How a zone should be shown back to the user, resolved at `timestamp` so a zone that observes
 * daylight saving reads EST in January and EDT in July rather than always the first row in the table.
 */
export function TimezoneLabel(zone: string, timestamp: number = Date.now()): string {
	if (!BY_ZONE) {
		BY_ZONE = new Map();
		for (const candidate of TIMEZONE_TABLE) {
			const canonical = CanonicalZone(candidate.iana);
			if (!canonical) continue;

			const existing = BY_ZONE.get(canonical);
			if (existing) existing.push(candidate);
			else BY_ZONE.set(canonical, [candidate]);
		}
	}

	const canonical = CanonicalZone(zone);
	const rows = canonical ? BY_ZONE.get(canonical) : undefined;
	if (!rows?.length) return OffsetLabel(zone, timestamp);

	const standard = rows.find(row => !row.daylight) ?? rows[0];
	const daylight = rows.find(row => row.daylight);
	if (!daylight) return standard.abbreviation;

	// A zone is on daylight saving when it is further ahead of UTC than it is in the middle of winter.
	// January is standard time in the northern hemisphere; for southern zones the two are swapped, so
	// take the smaller of the January and July offsets as the standard one either way.
	const year = new Date(timestamp).getUTCFullYear();
	const winter = ZoneOffset(zone, Date.UTC(year, 0, 15));
	const summer = ZoneOffset(zone, Date.UTC(year, 6, 15));
	const standardOffset = Math.min(winter, summer);

	return ZoneOffset(zone, timestamp) > standardOffset ? daylight.abbreviation : standard.abbreviation;
}

/**
 * Optimal string alignment distance - Levenshtein, plus swapping two adjacent characters counted as
 * one edit rather than two.
 *
 * The transposition case is the reason for the extra row: "ETS" for "EST" is the single most likely
 * way to mistype a three letter abbreviation, and plain Levenshtein scores it 2, far enough away to be
 * indistinguishable from an unrelated string.
 *
 * Only ever run against the abbreviation list (a few dozen strings of 2-4 characters), so the naive
 * implementation is more than fast enough and avoids a dependency.
 */
function EditDistance(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;

	let beforePrevious = new Array<number>(b.length + 1);
	let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	let current = new Array<number>(b.length + 1);

	for (let i = 1; i <= a.length; i++) {
		current[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
			current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);

			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				current[j] = Math.min(current[j], beforePrevious[j - 2] + 1);
			}
		}
		[beforePrevious, previous, current] = [previous, current, beforePrevious];
	}

	return previous[b.length];
}

/**
 * `UTC-5`, `+8`, `GMT+05:00` to an `Etc/GMT` zone, or null if it is not an offset at all.
 *
 * Etc zones invert the sign - `Etc/GMT+5` is five hours *behind* UTC - which is why this cannot just
 * interpolate the input. Half hour offsets have no Etc zone, so they are rejected here and the caller
 * tells the user to use an abbreviation instead.
 */
function ParseOffset(input: string): string | null {
	const match = /^(?:UTC|GMT)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/.exec(input);
	if (!match) return null;

	const [, sign, rawHours, rawMinutes] = match;
	const hours = Number(rawHours);
	const minutes = Number(rawMinutes ?? 0);

	if (minutes !== 0) return null;
	if (hours === 0) return DEFAULT_TIMEZONE;

	// Etc/GMT+N is behind UTC, so a user's "UTC-5" is "Etc/GMT+5". The range is lopsided
	// (+12 east, -14 west) so the bound is left to ICU rather than hard coded here.
	return CanonicalZone(`Etc/GMT${sign === '-' ? '+' : '-'}${hours}`);
}

/**
 * Puts a zone path into the spelling tzdata uses.
 *
 * Zone names separate words with underscores, which nobody types - "america/new york" is the natural
 * way to write one out, and "America / New_York" is what you get from copying one out of a table. Both
 * are unambiguous, so they are corrected rather than rejected.
 */
function NormalizeZonePath(input: string): string {
	// Hyphens are left alone - America/Port-au-Prince is spelled with them
	return input
		.replace(/\s*\/\s*/g, '/')
		.replace(/\s+/g, '_');
}

/**
 * Zone paths within a couple of edits of the input, as candidates.
 *
 * Only reached when a path shaped input failed to resolve outright, so walking every zone ICU knows is
 * a fair price for turning a dead end into a list. The abbreviation is resolved through
 * `TimezoneLabel`, which falls back to a UTC offset for the many zones that have no name of their own.
 */
function NearestZones(path: string): TimezoneCandidate[] {
	const target = path.toLowerCase();
	const scored: { zone: string; distance: number }[] = [];

	for (const zone of Intl.supportedValuesOf('timeZone')) {
		const distance = EditDistance(target, zone.toLowerCase());
		if (distance <= 2) scored.push({ zone, distance });
	}

	scored.sort((a, b) => a.distance - b.distance || a.zone.localeCompare(b.zone));

	return scored.slice(0, MAX_SUGGESTED_ABBREVIATIONS).map(entry => ({
		abbreviation: TimezoneLabel(entry.zone),
		iana: entry.zone,
		region: entry.zone.replace(/_/g, ' ')
	}));
}

/**
 * Works out which zone the user meant, without ever guessing on their behalf.
 *
 * Accepts an abbreviation (`EST`), a UTC offset (`UTC+2`, `+8`) or a raw IANA name
 * (`Europe/London`). See `TimezoneResolution` for what each outcome means - only `resolved` should
 * ever be written to the database directly.
 */
export function ResolveTimezone(input: string): TimezoneResolution {
	const trimmed = input.trim().replace(/\s+/g, ' ');
	if (!trimmed) return { kind: 'unknown', input: trimmed };

	const normalized = trimmed.toUpperCase();

	const offset = ParseOffset(normalized);
	if (offset) return { kind: 'resolved', zone: offset };

	// Only spellings that look like a zone path are offered to ICU - it accepts bare "EST" and "GMT+8"
	// as zones too, which would shadow the abbreviation table and the offset parser above
	if (trimmed.includes('/')) {
		const path = NormalizeZonePath(trimmed);
		const iana = CanonicalZone(path);
		if (iana) return { kind: 'resolved', zone: iana };

		// A near miss on a zone path is nothing like a near miss on an abbreviation, so it gets its own
		// search rather than falling through to one that can only ever answer with three letters
		const near = NearestZones(path);
		if (near.length) return { kind: 'suggestions', input: trimmed, candidates: near };

		return { kind: 'unknown', input: trimmed };
	}

	const exact = BY_ABBREVIATION.get(normalized);
	if (exact) {
		if (exact.length === 1) return { kind: 'resolved', zone: exact[0].iana };
		return { kind: 'ambiguous', input: normalized, candidates: exact.slice(0, MAX_CANDIDATES) };
	}

	// Nothing matched, so fall back to offering the nearest few things that would have
	const tolerance = normalized.length <= 3 ? 1 : 2;
	const scored: { abbreviation: string; distance: number }[] = [];

	for (const abbreviation of BY_ABBREVIATION.keys()) {
		const distance = EditDistance(normalized, abbreviation);
		if (distance <= tolerance) scored.push({ abbreviation, distance });
	}

	// A phrase like "Pacific" or "China" is not close to any abbreviation but does name a region, and
	// sorts behind the edit distance matches because it is the weaker signal of the two
	if (normalized.length >= 3) {
		for (const [abbreviation, candidates] of BY_ABBREVIATION) {
			if (scored.some(entry => entry.abbreviation === abbreviation)) continue;
			if (candidates.some(candidate => candidate.region.toUpperCase().includes(normalized))) {
				scored.push({ abbreviation, distance: tolerance + 1 });
			}
		}
	}

	if (!scored.length) return { kind: 'unknown', input: trimmed };

	scored.sort((a, b) => a.distance - b.distance || a.abbreviation.localeCompare(b.abbreviation));

	// EST and EDT are one zone under two names, so a suggestion list built from abbreviations would
	// offer the same choice twice. Keep the first spelling of each zone that survived scoring.
	const seen = new Set<string>();
	const candidates: TimezoneCandidate[] = [];
	for (const entry of scored.slice(0, MAX_SUGGESTED_ABBREVIATIONS)) {
		for (const candidate of BY_ABBREVIATION.get(entry.abbreviation)!) {
			if (seen.has(candidate.iana)) continue;
			seen.add(candidate.iana);
			candidates.push(candidate);
			if (candidates.length === MAX_CANDIDATES) return { kind: 'suggestions', input: trimmed, candidates };
		}
	}

	return { kind: 'suggestions', input: trimmed, candidates };
}
