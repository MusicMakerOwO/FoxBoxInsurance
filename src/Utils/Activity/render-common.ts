/**
 * Shared chrome for the activity renderers (day rows / month / year).
 *
 * Everything the three frames have in common lives here: the font
 * registration, the palette, the canvas helpers node-canvas doesn't ship,
 * and the header / footer bands — all three frames are 1200px wide with the
 * same 30px gutters, so those bands are pixel-identical between them.
 *
 * The per-view files keep only their own geometry and their own charts.
 */

import { createCanvas, registerFont, Canvas, CanvasRenderingContext2D } from 'canvas';
import * as path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── fonts ────────────────────────────────────────────────────────────────
// MUST run before the first createCanvas() call or node-canvas silently
// falls back to its default sans and every metric in the views drifts.
const FONT_DIR = path.join(__dirname, '..', '..', '..', 'fonts');
registerFont(path.join(FONT_DIR, 'Inter_VariableFont_weight.ttf'), { family: 'Inter', weight: '400' });
registerFont(path.join(FONT_DIR, 'Inter_VariableFont_weight.ttf'), { family: 'Inter', weight: '500' });

// ─── palette ──────────────────────────────────────────────────────────────
export const COLORS = {
	pageBg: '#0b0604',
	bg: '#100904',
	surface: '#1a1007',
	text: '#efe6dc',
	n900: '#241608',
	n800: '#34200f',
	n700: '#4d321d',
	n600: '#7a6553',
	n500: '#8f7a66',
	n400: '#a89686',
	n300: '#c4b5a6',
	n200: '#e2d8cd',
	gridFaint: '#2b1c11',
	gridStrong: '#33231a',
	axis: '#4d321d',
	accent: '#e8913a',
	accentRGB: '232,145,58',
	accent200: '#fbd3aa',
	accent300: '#f7bb7f',
	accent600: '#c9762a',
	accent700: '#8f5320',
	accent900: '#33200f',
	barWeekday: '#8f5320',
	barWeekend: '#a35f22',
	barPeak: '#e8913a',
	weekendBand: 'rgba(232,145,58,0.05)',
	peakRing: '#fcd6ac',
};

// ─── shared frame geometry ────────────────────────────────────────────────
export const WIDTH = 1200;
export const SCALE = 2;
export const FRAME_RADIUS = 14;
export const PAD_X = 30;
export const PAD_TOP = 24;

/** Header band: avatar / name on the left, stat cards on the right. */
export const HEADER_Y = PAD_TOP;
export const HEADER_H = 57;
const AVATAR = 46;
const CARD_PAD = 16;
const CARD_GAP = 10;
const CARD_MIN_W = 104;

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 12 AM / 6 AM / 12 PM / 6 PM / 11 PM, the axis every hourly chart uses. */
export const HOUR_TICKS = [
	{ hour: 0, label: '12 AM', align: 'left' as const },
	{ hour: 6, label: '6 AM', align: 'center' as const },
	{ hour: 12, label: '12 PM', align: 'center' as const },
	{ hour: 18, label: '6 PM', align: 'center' as const },
	{ hour: 23, label: '11 PM', align: 'right' as const },
];

// ─── input ────────────────────────────────────────────────────────────────
export type DayBucket = {
	/**
	 * Local midnight of the day, shifted so the **UTC** fields read as the viewer's wall clock -
	 * see `Utils/ZonedTime.ts`. Always read it with `getUTC*`; `getDate()` and friends would apply
	 * the process offset on top and land on the wrong day.
	 */
	date: Date;
	/** exactly 24 values, index 0 = 00:00 local */
	hours: number[];
};

/** The options every view accepts; each view adds its own data on top. */
export type ViewOptions = {
	serverName: string;
	/** avatar, 1-2 chars */
	initials: string;
	subtitle?: string;
	timezone?: string;
	lookback?: string;
};

// ─── canvas helpers ───────────────────────────────────────────────────────
/** node-canvas < 2.11 has no ctx.roundRect. */
export function RoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	const rr = Math.min(r, w / 2, h / 2);
	ctx.beginPath();
	ctx.moveTo(x + rr, y);
	ctx.arcTo(x + w, y, x + w, y + h, rr);
	ctx.arcTo(x + w, y + h, x, y + h, rr);
	ctx.arcTo(x, y + h, x, y, rr);
	ctx.arcTo(x, y, x + w, y, rr);
	ctx.closePath();
}

/** Rounded on the top two corners only — the column bars. */
export function TopRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	const rr = Math.min(r, w / 2, h);
	ctx.beginPath();
	ctx.moveTo(x, y + h);
	ctx.lineTo(x, y + rr);
	ctx.arcTo(x, y, x + rr, y, rr);
	ctx.lineTo(x + w - rr, y);
	ctx.arcTo(x + w, y, x + w, y + rr, rr);
	ctx.lineTo(x + w, y + h);
	ctx.closePath();
}

export function DrawText(
	ctx: CanvasRenderingContext2D, str: string, x: number, y: number,
	font: string, fill: string, align: CanvasTextAlign = 'left',
): void {
	ctx.font = font;
	ctx.fillStyle = fill;
	ctx.textAlign = align;
	ctx.textBaseline = 'alphabetic';
	ctx.fillText(str, x, y);
	ctx.textAlign = 'left';
}

/** Hairline that fades out over the last 48px at each end. */
export function FadedRule(ctx: CanvasRenderingContext2D, y: number): void {
	const x0 = PAD_X, x1 = WIDTH - PAD_X, len = x1 - x0;
	const g = ctx.createLinearGradient(x0, 0, x1, 0);
	g.addColorStop(0, 'rgba(52,32,15,0)');
	g.addColorStop(48 / len, COLORS.n800);
	g.addColorStop(1 - 48 / len, COLORS.n800);
	g.addColorStop(1, 'rgba(52,32,15,0)');
	ctx.fillStyle = g;
	ctx.fillRect(x0, y, len, 1);
}

/** Letter-spaced caps for the stat-card labels (0.09em at 10px ≈ 0.9px). */
export function TrackedCaps(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, fill: string): void {
	ctx.font = '400 10px Inter';
	ctx.fillStyle = fill;
	ctx.textBaseline = 'alphabetic';
	let cx = x;
	for (const ch of str) {
		ctx.fillText(ch, cx, y);
		cx += ctx.measureText(ch).width + 0.9;
	}
}

/** Width of a tracked-caps run, for laying out around it. */
function TrackedCapsWidth(ctx: CanvasRenderingContext2D, str: string): number {
	ctx.font = '400 10px Inter';
	return ctx.measureText(str).width + str.length * 0.9;
}

/** Same cubic smoothing as the SVG: controls at the horizontal midpoint, flat
 *  at each end, so peaks stay honest. */
export function SmoothPath(
	ctx: CanvasRenderingContext2D, vals: number[],
	xAt: (i: number) => number, yAt: (v: number) => number,
): void {
	ctx.beginPath();
	ctx.moveTo(xAt(0), yAt(vals[0]));
	for (let i = 1; i < vals.length; i++) {
		const mid = (xAt(i - 1) + xAt(i)) / 2;
		ctx.bezierCurveTo(mid, yAt(vals[i - 1]), mid, yAt(vals[i]), xAt(i), yAt(vals[i]));
	}
}

/** The vertical accent wash under an hourly curve. */
export function AccentGradient(ctx: CanvasRenderingContext2D, top: number, base: number, from: number, to: number): CanvasGradient {
	const g = ctx.createLinearGradient(0, top, 0, base);
	g.addColorStop(0, `rgba(${COLORS.accentRGB},${from})`);
	g.addColorStop(1, `rgba(${COLORS.accentRGB},${to})`);
	return g;
}

export function DrawHourTicks(
	ctx: CanvasRenderingContext2D, xAt: (hour: number) => number, y: number,
	font: string, fill: string = COLORS.n600,
): void {
	for (const tick of HOUR_TICKS) DrawText(ctx, tick.label, xAt(tick.hour), y, font, fill, tick.align);
}

// ─── data helpers ─────────────────────────────────────────────────────────
export function SumHours(hours: number[]): number {
	return hours.reduce((a, b) => a + b, 0);
}

export function DayTotals(days: { hours: number[] }[]): number[] {
	return days.map(d => SumHours(d.hours));
}

export function IsWeekend(date: Date): boolean {
	return date.getUTCDay() === 0 || date.getUTCDay() === 6;
}

/** 0 → '12 AM', 15 → '3 PM'. */
export function FormatHour(hour: number): string {
	return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** Rolling mean over the window [i - back, i + forward], clamped at the ends. */
export function RollingAverage(vals: number[], back: number, forward: number): number[] {
	return vals.map((_, i) => {
		const a = Math.max(0, i - back), b = Math.min(vals.length, i + forward + 1);
		return vals.slice(a, b).reduce((x, v) => x + v, 0) / (b - a);
	});
}

/** Round a max up to a clean gridline unit. */
export function NiceUnit(max: number, lines: number): number {
	const raw = max / lines;
	const step = Math.pow(10, Math.floor(Math.log10(raw)));
	const mult = [1, 2, 2.5, 5, 10].find(m => step * m >= raw) || 10;
	return step * mult;
}

/** Percent change, guarding the divide-by-zero when there is no baseline. */
export function PercentChange(from: number, to: number): number {
	return from ? Math.round((to - from) / from * 100) : 0;
}

// ─── bands ────────────────────────────────────────────────────────────────
/**
 * Page background, rounded clip, card background. The clip is left on the
 * stack — pair this with ctx.restore() before reading the buffer.
 */
export function CreateFrame(height: number): { canvas: Canvas; ctx: CanvasRenderingContext2D } {
	const canvas = createCanvas(WIDTH * SCALE, height * SCALE);
	const ctx = canvas.getContext('2d');
	ctx.scale(SCALE, SCALE);
	ctx.textBaseline = 'alphabetic';

	ctx.fillStyle = COLORS.pageBg;
	ctx.fillRect(0, 0, WIDTH, height);
	ctx.save();
	RoundRect(ctx, 0, 0, WIDTH, height, FRAME_RADIUS);
	ctx.clip();
	ctx.fillStyle = COLORS.bg;
	ctx.fillRect(0, 0, WIDTH, height);

	return { canvas, ctx };
}

export type StatCard = { label: string; value: string; color: string };

/** Avatar + server name on the left, stat cards laid out right-to-left. */
export function DrawHeader(ctx: CanvasRenderingContext2D, opts: {
	serverName: string;
	initials: string;
	subtitle: string;
	cards: StatCard[];
}): void {
	const avatarY = HEADER_Y + (HEADER_H - AVATAR) / 2;
	RoundRect(ctx, PAD_X, avatarY, AVATAR, AVATAR, 10);
	ctx.fillStyle = COLORS.accent900;
	ctx.fill();
	ctx.strokeStyle = COLORS.accent700;
	ctx.lineWidth = 1;
	ctx.stroke();
	ctx.textBaseline = 'middle';
	DrawText(ctx, opts.initials, PAD_X + AVATAR / 2, avatarY + AVATAR / 2 + 1, '500 16px Inter', COLORS.accent300, 'center');
	ctx.textBaseline = 'alphabetic';

	const tx = PAD_X + AVATAR + 14;
	DrawText(ctx, opts.serverName, tx, HEADER_Y + 25, '500 21px Inter', COLORS.text);
	DrawText(ctx, opts.subtitle, tx, HEADER_Y + 43, '400 13px Inter', COLORS.n500);

	let cardRight = WIDTH - PAD_X;
	for (const card of opts.cards.slice().reverse()) {
		ctx.font = '500 24px Inter';
		const valueW = ctx.measureText(card.value).width;
		const cw = Math.max(CARD_MIN_W, Math.max(valueW, TrackedCapsWidth(ctx, card.label)) + CARD_PAD * 2);
		const cx = cardRight - cw;

		RoundRect(ctx, cx, HEADER_Y, cw, HEADER_H, 8);
		ctx.fillStyle = COLORS.surface;
		ctx.fill();
		ctx.strokeStyle = COLORS.n800;
		ctx.lineWidth = 1;
		ctx.stroke();

		TrackedCaps(ctx, card.label, cx + CARD_PAD, HEADER_Y + 18, COLORS.n500);
		DrawText(ctx, card.value, cx + CARD_PAD, HEADER_Y + 44, '500 24px Inter', card.color);
		cardRight = cx - CARD_GAP;
	}
}

/** Rule, then "Server Lookback / Timezone" on the left and a note on the right. */
export function DrawFooter(ctx: CanvasRenderingContext2D, opts: {
	ruleY: number;
	baseline: number;
	lookback: string;
	timezone: string;
	note: string;
}): void {
	FadedRule(ctx, opts.ruleY);

	let fx = PAD_X;
	const segments: [string, string][] = [
		['Server Lookback:', COLORS.n400],
		[` ${opts.lookback} — `, COLORS.n600],
		['Timezone:', COLORS.n400],
		[` ${opts.timezone}`, COLORS.n600],
	];
	for (const [str, fill] of segments) {
		DrawText(ctx, str, fx, opts.baseline, '400 11px Inter', fill);
		fx += ctx.measureText(str).width;
	}

	DrawText(ctx, opts.note, WIDTH - PAD_X, opts.baseline, '400 11px Inter', COLORS.n600, 'right');
}
