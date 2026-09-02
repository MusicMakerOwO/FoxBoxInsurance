/**
 * Day Rows renderer — node-canvas port of "Message History - Day Rows".
 *
 * Every number below is lifted from the HTML design: the 1200x650 frame,
 * 30px side padding, the 104 / 900 / 1fr column grid with 14px gutters, and
 * the 52px sparkline band. Shared chrome (palette, fonts, header, footer)
 * lives in render-common.ts.
 */

import {
	COLORS, WIDTH, PAD_X,
	AccentGradient, CreateFrame, DayTotals, DrawFooter, DrawHeader, DrawHourTicks, DrawText,
	FadedRule, FormatHour, RoundRect, SmoothPath, SumHours, ViewOptions,
} from './render-common.js';

// ─── frame geometry ───────────────────────────────────────────────────────
const HEIGHT = 650;

const COL_LABEL_X = PAD_X;      // 30 — day name / date
const COL_CHART_X = 148;        // 30 + 104 + 14
const COL_CHART_W = 900;
const COL_TOTAL_X = 1062;       // 148 + 900 + 14
const COL_TOTAL_W = 108;        // to the right padding edge (1170)

const DIVIDER_1_Y = 99;         // header bottom (81) + 18 margin
const AXIS_Y = 111;             // + 12 margin
const ROWS_TOP = 131;           // axis row (14) + 4 margin + 2 padding
const ROWS_BOTTOM = 592;
const DIVIDER_2_Y = 606;
const FOOTER_BASELINE = 627;

const ROW_H = 52;               // the sparkline band
const ROW_COUNT = 7;
const ROW_GAP = (ROWS_BOTTOM - ROWS_TOP - ROW_H * ROW_COUNT) / (ROW_COUNT - 1); // ≈16.2
const ROW_PITCH = ROW_H + ROW_GAP;

// ─── input ────────────────────────────────────────────────────────────────
export type DayBucket = {
	/** 'Wednesday' */
	name: string;
	/** '20 Aug' */
	date: string;
	/** exactly 24 values, index 0 = 00:00 local */
	hours: number[];
};

export type DayRowsOptions = ViewOptions & {
	/** 7 entries, oldest first */
	days: DayBucket[];
};

// ─── the renderer ─────────────────────────────────────────────────────────
export function renderDayRows(opts: DayRowsOptions): Buffer {
	const {
		days, serverName, initials,
		subtitle = '# Messages · last 7 days',
		timezone = 'UTC',
		lookback = 'Last 7 days',
	} = opts;

	const { canvas, ctx } = CreateFrame(HEIGHT);

	// ── scales. One shared hourly max across all rows: that shared scale is
	// the whole point of this layout — row heights are comparable.
	const maxHour = Math.max(1, ...days.flatMap(d => d.hours));
	const totals = DayTotals(days);
	const maxTotal = Math.max(1, ...totals);
	const grandTotal = SumHours(totals);

	const hourProfile = new Array<number>(24).fill(0);
	for (const day of days) {
		for (const [i, v] of day.hours.entries()) hourProfile[i] += v;
	}

	DrawHeader(ctx, {
		serverName, initials, subtitle,
		cards: [
			{ label: 'MESSAGES', value: grandTotal.toLocaleString(), color: COLORS.text },
			{ label: 'PEAK HOUR', value: FormatHour(hourProfile.indexOf(Math.max(...hourProfile))), color: COLORS.accent300 },
		],
	});

	FadedRule(ctx, DIVIDER_1_Y);

	// ── axis row: legend swatch, hour ticks, right-hand caption
	const hx = (i: number) => COL_CHART_X + (i / 23) * COL_CHART_W;

	RoundRect(ctx, COL_LABEL_X, AXIS_Y + 2, 10, 10, 2);
	ctx.fillStyle = COLORS.accent;
	ctx.fill();
	DrawText(ctx, 'Hourly', COL_LABEL_X + 17, AXIS_Y + 11, '400 12px Inter', COLORS.n400);
	DrawHourTicks(ctx, hx, AXIS_Y + 10, '400 11px Inter');
	DrawText(ctx, 'Day total', WIDTH - PAD_X, AXIS_Y + 11, '400 12px Inter', COLORS.n400, 'right');

	// ── the seven rows
	for (const [di, day] of days.entries()) {
		const top = ROWS_TOP + di * ROW_PITCH;
		const base = top + ROW_H;
		const total = totals[di];

		// day name + date, vertically centred against the 52px band
		DrawText(ctx, day.name, COL_LABEL_X, top + 22, '500 14px Inter', COLORS.n200);
		DrawText(ctx, day.date, COL_LABEL_X, top + 36, '400 11px Inter', COLORS.n600);

		// gridlines: baseline + 6AM / 12PM / 6PM verticals
		ctx.strokeStyle = COLORS.gridStrong;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(COL_CHART_X, base + 0.5);
		ctx.lineTo(COL_CHART_X + COL_CHART_W, base + 0.5);
		for (const i of [6, 12, 18]) {
			const gx = Math.round(hx(i)) + 0.5;
			ctx.moveTo(gx, top);
			ctx.lineTo(gx, base);
		}
		ctx.stroke();

		// sparkline: fill under the curve, then the curve itself
		const vy = (v: number) => base - (v / maxHour) * (ROW_H - 4);
		const trace = () => SmoothPath(ctx, day.hours, hx, vy);

		trace();
		ctx.lineTo(hx(23), base);
		ctx.lineTo(hx(0), base);
		ctx.closePath();
		ctx.fillStyle = AccentGradient(ctx, top, base, 0.42, 0.04);
		ctx.fill();

		trace();
		ctx.strokeStyle = COLORS.accent;
		ctx.lineWidth = 1.75;
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		ctx.stroke();

		// peak-hour marker
		const pi = day.hours.indexOf(Math.max(...day.hours));
		ctx.beginPath();
		ctx.arc(hx(pi), vy(day.hours[pi]), 3, 0, Math.PI * 2);
		ctx.fillStyle = COLORS.bg;
		ctx.fill();
		ctx.strokeStyle = COLORS.peakRing;
		ctx.lineWidth = 1.75;
		ctx.stroke();

		// day total + its share-of-max bar
		DrawText(ctx, total.toLocaleString(), WIDTH - PAD_X, top + 30, '500 15px Inter', COLORS.n200, 'right');
		RoundRect(ctx, COL_TOTAL_X, top + 35, COL_TOTAL_W, 4, 2);
		ctx.fillStyle = COLORS.n900;
		ctx.fill();
		RoundRect(ctx, COL_TOTAL_X, top + 35, Math.max(2, (total / maxTotal) * COL_TOTAL_W), 4, 2);
		ctx.fillStyle = COLORS.accent600;
		ctx.fill();
	}

	DrawFooter(ctx, {
		ruleY: DIVIDER_2_Y,
		baseline: FOOTER_BASELINE,
		lookback, timezone,
		note: 'Each row shares one scale — peak hour marked',
	});

	ctx.restore();
	return canvas.toBuffer('image/png');
}