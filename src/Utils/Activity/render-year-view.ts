/**
 * 12-month view — node-canvas port of the "12 months" frame.
 *
 * Frame is 1200x660: a 365-day trend block on top, then two panels — month
 * totals as bars, and an hour-by-month heatmap. Pass whole calendar months —
 * a partial month draws a short totals bar that reads as a collapse.
 * Shared chrome lives in render-common.ts.
 */

import { CanvasRenderingContext2D } from 'canvas';
import {
	COLORS, WIDTH, PAD_X, MONTH_NAMES,
	CreateFrame, DayTotals, DrawFooter, DrawHeader, DrawHourTicks, DrawText, FadedRule,
	NiceUnit, PercentChange, RollingAverage, RoundRect, SmoothPath, SumHours, ViewOptions, DayBucket,
} from './render-common.js';

export type { DayBucket };

// ─── frame geometry ───────────────────────────────────────────────────────
const HEIGHT = 660;

const RULE_1_Y = 99;

// trend block: 68px label column, 50px gutter, 900px plot
const TREND_X = 148;
const TREND_W = 900;
const TREND_TOP = 114;
const TREND_BASE = 233.5;
const TREND_H = TREND_BASE - TREND_TOP;
const TREND_LINES = 3;            // horizontal gridlines above the axis
const TREND_BAR_W = 1.7;
const RULE_2_Y = 272;

// two panels below, 640px + 44px gutter + the rest
const PANEL_HEAD_Y = 291;         // grid top (273) + 18 padding-top
const PANEL_BODY_Y = 321;         // + heading 16 + 14 margin

const MB_X = PAD_X;               // month-totals bar chart
const MB_W = 640;
const MB_H = 167.5;
const MB_BASE = PANEL_BODY_Y + MB_H;
const MB_LINES = 3;

const HM_X = PAD_X + MB_W + 44;   // heatmap panel
const HM_W = WIDTH - PAD_X - HM_X;
const HM_LABEL_W = 44;
const HM_GAP = 8;
const HM_GRID_X = HM_X + HM_LABEL_W + HM_GAP;
const HM_GRID_W = HM_W - HM_LABEL_W - HM_GAP;
const HM_CELL_H = 12;
const HM_CELL_GAP = 2;
const HM_CELL_W = (HM_GRID_W - HM_CELL_GAP * 23) / 24;

const RULE_3_Y = 616;
const FOOTER_BASELINE = 636;

const HEAT_STOPS = [[36, 22, 14], [92, 54, 22], [163, 95, 34], [232, 145, 58]];

// ─── input ────────────────────────────────────────────────────────────────
export type YearViewOptions = ViewOptions & {
	/** every day in the window, oldest first — whole calendar months only */
	days: DayBucket[];
	/** footer range, e.g. 'Aug 2025 – Jul 2026'; derived from the data if omitted */
	lookback?: string;
};

type Month = {
	/** "Aug '25" */
	name: string;
	/** index into `days` of the month's first day */
	first: number;
	count: number;
	hours: number[];
	total: number;
};

// ─── local helpers ────────────────────────────────────────────────────────
/** Bucket the days into calendar months, in order. */
function GroupByMonth(days: DayBucket[], totals: number[]): Month[] {
	const months: Month[] = [];
	for (const [i, day] of days.entries()) {
		const name = `${MONTH_NAMES[day.date.getUTCMonth()]} '${String(day.date.getUTCFullYear()).slice(2)}`;
		let month = months[months.length - 1];
		if (!month || month.name !== name) {
			month = { name, first: i, count: 0, hours: new Array<number>(24).fill(0), total: 0 };
			months.push(month);
		}
		month.count++;
		month.total += totals[i];
		for (const [h, v] of day.hours.entries()) month.hours[h] += v;
	}
	return months;
}

/** Gamma 0.75 lifts the mid-range so quiet-but-not-dead hours stay visible. */
function HeatColor(t: number): string {
	const c = Math.max(0, Math.min(1, Math.pow(t, 0.75))) * (HEAT_STOPS.length - 1);
	const i = Math.min(HEAT_STOPS.length - 2, Math.floor(c)), f = c - i;
	const mix = (k: number) => Math.round(HEAT_STOPS[i][k] + (HEAT_STOPS[i + 1][k] - HEAT_STOPS[i][k]) * f);
	return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

/** Month totals run into five figures — '12.3k' keeps the bar labels short. */
function Compact(v: number): string {
	return v >= 10000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toLocaleString();
}

/** Where the heatmap's hour-axis label for `hour` sits: column edge at the
 *  ends (which are the grid edges), column centre in between. */
function HeatTickX(hour: number): number {
	if (hour === 0) return HM_GRID_X;
	if (hour === 23) return HM_GRID_X + HM_GRID_W;
	return HM_GRID_X + hour * (HM_CELL_W + HM_CELL_GAP) + HM_CELL_W / 2;
}

/** "quiet ▪▪▪▪ busy", laid out right-to-left from the frame edge. */
function DrawHeatLegend(ctx: CanvasRenderingContext2D, y: number): void {
	const SWATCH = 11, GAP = 6;
	let x = WIDTH - PAD_X;

	ctx.font = '400 10px Inter';
	x -= ctx.measureText('busy').width;
	DrawText(ctx, 'busy', x, y + 12, '400 10px Inter', COLORS.n600);
	x -= GAP;

	for (const t of [1, 0.66, 0.33, 0]) {
		x -= SWATCH;
		RoundRect(ctx, x, y + 2, SWATCH, SWATCH, 2);
		ctx.fillStyle = HeatColor(t);
		ctx.fill();
		x -= GAP;
	}

	DrawText(ctx, 'quiet', x, y + 12, '400 10px Inter', COLORS.n600, 'right');
}

// ─── the renderer ─────────────────────────────────────────────────────────
export function renderYearView(opts: YearViewOptions): Buffer {
	const {
		days, serverName, initials,
		subtitle = '# Messages · last 12 months',
		timezone = 'UTC',
	} = opts;

	const { canvas, ctx } = CreateFrame(HEIGHT);

	const totals = DayTotals(days);
	const n = days.length;

	const months = GroupByMonth(days, totals);
	const avgHours = months.map(m => m.hours.map(v => v / m.count));
	const hourMax = Math.max(1, ...avgHours.flat());
	const maxMonthTotal = Math.max(1, ...months.map(m => m.total));

	const firstDay = days[0].date, lastDay = days[n - 1].date;
	const lookback = opts.lookback
		?? `${MONTH_NAMES[firstDay.getUTCMonth()]} ${firstDay.getUTCFullYear()} – ${MONTH_NAMES[lastDay.getUTCMonth()]} ${lastDay.getUTCFullYear()}`;

	// ── header. "vs prev year" compares the two halves of the window.
	const busiestDate = days[totals.indexOf(Math.max(...totals))].date;
	const half = Math.floor(n / 2);
	const pct = PercentChange(SumHours(totals.slice(0, half)), SumHours(totals.slice(n - half)));

	DrawHeader(ctx, {
		serverName, initials, subtitle,
		cards: [
			{ label: 'MESSAGES', value: SumHours(totals).toLocaleString(), color: COLORS.text },
			{ label: 'BUSIEST DAY', value: `${busiestDate.getUTCDate()} ${MONTH_NAMES[busiestDate.getUTCMonth()]}`, color: COLORS.accent300 },
			{ label: 'VS PREV YEAR', value: `${pct >= 0 ? '+' : ''}${pct}%`, color: COLORS.accent300 },
		],
	});

	FadedRule(ctx, RULE_1_Y);

	// ── trend block: 365 daily bars + 7-day average
	DrawText(ctx, 'Daily totals', PAD_X, TREND_TOP + 13, '500 12px Inter', COLORS.n300);
	DrawText(ctx, `${n} days`, PAD_X, TREND_TOP + 31, '400 11px Inter', COLORS.n600);
	DrawText(ctx, '7-day average', PAD_X, TREND_TOP + 46, '400 11px Inter', COLORS.n600);

	const dayMax = Math.max(1, ...totals);
	const dStep = Math.pow(10, Math.floor(Math.log10(dayMax / TREND_LINES)));
	const dUnit = Math.ceil(dayMax / TREND_LINES / dStep) * dStep;
	const ty = (v: number) => TREND_BASE - (v / (dUnit * TREND_LINES)) * TREND_H;
	const dx = (i: number) => TREND_X + (i / (n - 1)) * (TREND_W - TREND_BAR_W);

	ctx.strokeStyle = COLORS.gridFaint;
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (let k = 1; k <= TREND_LINES; k++) {
		const gy = Math.round(ty(dUnit * k)) + 0.5;
		ctx.moveTo(TREND_X, gy);
		ctx.lineTo(TREND_X + TREND_W, gy);
	}
	for (const month of months) {
		const mx = Math.round(dx(month.first)) + 0.5;
		ctx.moveTo(mx, TREND_TOP);
		ctx.lineTo(mx, TREND_BASE);
	}
	ctx.stroke();

	ctx.strokeStyle = COLORS.axis;
	ctx.beginPath();
	ctx.moveTo(TREND_X, TREND_BASE + 0.5);
	ctx.lineTo(TREND_X + TREND_W, TREND_BASE + 0.5);
	ctx.stroke();

	for (let k = 1; k <= TREND_LINES; k++) {
		DrawText(ctx, Math.round(dUnit * k).toLocaleString(), TREND_X - 8, ty(dUnit * k) + 3.5, '400 10px Inter', COLORS.n600, 'right');
	}

	ctx.fillStyle = COLORS.accent700;
	for (const [i, v] of totals.entries()) {
		const h = Math.max(0.8, TREND_BASE - ty(v));
		ctx.fillRect(dx(i), TREND_BASE - h, TREND_BAR_W, h);
	}

	// centred 7-day average
	SmoothPath(ctx, RollingAverage(totals, 3, 3), dx, ty);
	ctx.strokeStyle = COLORS.accent300;
	ctx.lineWidth = 1.9;
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.stroke();

	for (const month of months) {
		const mid = (dx(month.first) + dx(Math.min(n - 1, month.first + month.count))) / 2;
		DrawText(ctx, month.name.slice(0, 3), mid, TREND_TOP + 133, '400 11px Inter', COLORS.n400, 'center');
	}

	FadedRule(ctx, RULE_2_Y);

	// ── panel: messages per month
	DrawText(ctx, 'Messages per month', MB_X, PANEL_HEAD_Y + 13, '500 13px Inter', COLORS.n200);
	DrawText(ctx, 'busiest month highlighted', MB_X + MB_W, PANEL_HEAD_Y + 13, '400 11px Inter', COLORS.n600, 'right');

	const mUnit = NiceUnit(maxMonthTotal, MB_LINES);
	const my = (v: number) => MB_BASE - (v / (mUnit * MB_LINES)) * MB_H;
	const mSlot = MB_W / months.length;
	const mBarW = mSlot * 0.56;
	const mcx = (i: number) => MB_X + mSlot * i + mSlot / 2;

	ctx.strokeStyle = COLORS.gridFaint;
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (let k = 1; k <= MB_LINES; k++) {
		const gy = Math.round(my(mUnit * k)) + 0.5;
		ctx.moveTo(MB_X, gy);
		ctx.lineTo(MB_X + MB_W, gy);
	}
	ctx.stroke();

	ctx.strokeStyle = COLORS.axis;
	ctx.beginPath();
	ctx.moveTo(MB_X, MB_BASE + 0.5);
	ctx.lineTo(MB_X + MB_W, MB_BASE + 0.5);
	ctx.stroke();

	for (let k = 1; k <= MB_LINES; k++) {
		DrawText(ctx, Compact(mUnit * k), MB_X - 10, my(mUnit * k) + 3.5, '400 10px Inter', COLORS.n600, 'right');
	}

	for (const [i, month] of months.entries()) {
		const top = my(month.total);
		const h = Math.max(2, MB_BASE - top);
		const peak = month.total === maxMonthTotal;

		RoundRect(ctx, mcx(i) - mBarW / 2, MB_BASE - h, mBarW, h, 3);
		ctx.fillStyle = peak ? COLORS.accent : COLORS.accent700;
		ctx.fill();

		DrawText(ctx, Compact(month.total), mcx(i), top - 6, '500 10px Inter', peak ? COLORS.accent300 : COLORS.n400, 'center');
		DrawText(ctx, month.name.slice(0, 3), mcx(i), MB_BASE + 20, '400 11px Inter', peak ? COLORS.n200 : COLORS.n600, 'center');
	}

	// ── panel: hour-by-month heatmap
	DrawText(ctx, 'Time of day, month by month', HM_X, PANEL_HEAD_Y + 13, '500 13px Inter', COLORS.n200);
	DrawHeatLegend(ctx, PANEL_HEAD_Y);

	for (const [mi, month] of months.entries()) {
		const rowY = PANEL_BODY_Y + mi * (HM_CELL_H + HM_CELL_GAP);
		DrawText(ctx, month.name, HM_X + HM_LABEL_W, rowY + 9, '400 10px Inter', COLORS.n500, 'right');
		for (const [h, v] of avgHours[mi].entries()) {
			RoundRect(ctx, HM_GRID_X + h * (HM_CELL_W + HM_CELL_GAP), rowY, HM_CELL_W, HM_CELL_H, 2);
			ctx.fillStyle = HeatColor(v / hourMax);
			ctx.fill();
		}
	}

	const heatBottom = PANEL_BODY_Y + months.length * (HM_CELL_H + HM_CELL_GAP) - HM_CELL_GAP;
	DrawHourTicks(ctx, HeatTickX, heatBottom + 17, '400 10px Inter');

	DrawFooter(ctx, {
		ruleY: RULE_3_Y,
		baseline: FOOTER_BASELINE,
		lookback, timezone,
		note: 'Heatmap rows share one scale — hourly detail lives in the 7-day view',
	});

	ctx.restore();
	return canvas.toBuffer('image/png');
}
