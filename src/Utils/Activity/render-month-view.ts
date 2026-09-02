/**
 * 30-day view — node-canvas port of the "30 days" frame.
 *
 * Frame is 1200x760: a daily-total bar chart on top, then two panels — the
 * average day by hour, and the average day by weekday. Layout constants below
 * are the HTML's numbers made explicit; the flow that produced them is noted
 * where it isn't obvious. Shared chrome lives in render-common.ts.
 */

import {
	COLORS, WIDTH, PAD_X, DAY_NAMES, MONTH_NAMES,
	AccentGradient, CreateFrame, DayTotals, DrawFooter, DrawHeader, DrawHourTicks, DrawText,
	FadedRule, FormatHour, IsWeekend, NiceUnit, PercentChange, RollingAverage, RoundRect,
	SmoothPath, StatCard, SumHours, TopRoundRect, ViewOptions, DayBucket,
} from './render-common.js';

export type { DayBucket };

// ─── frame geometry ───────────────────────────────────────────────────────
const HEIGHT = 760;

const RULE_1_Y = 99;
const SECTION_HEAD_Y = 116;    // rule + 16 margin
const CHART_X = 66;            // PAD_X + 36 margin-left
const CHART_W = 1104;
const CHART_TOP = 144;
const CHART_BASE = 415.5;      // CHART_TOP + 271.5
const CHART_H = CHART_BASE - CHART_TOP;
const CHART_LINES = 4;         // horizontal gridlines above the axis
const RULE_2_Y = 466;

const PANEL_HEAD_Y = 485;      // rule + 18 padding-top
const PANEL_TOP = 513;         // + heading 16 + 12 margin
const PANEL_H = 104;
const PANEL_BASE = PANEL_TOP + PANEL_H;
const PANEL_W = 550;           // (1140 - 40 gap) / 2
const PANEL_GAP = 40;
const PANEL_R_X = PAD_X + PANEL_W + PANEL_GAP;

const RULE_3_Y = 716;
const FOOTER_BASELINE = 737;

/** Monday-first, the order the weekday panel reads in. */
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DOW_GAP = 10;

// ─── input ────────────────────────────────────────────────────────────────
export type MonthViewOptions = ViewOptions & {
	/** the 30 days being charted, oldest first */
	days: DayBucket[];
	/** the 30 days before those — drives the "vs prev 30d" stat; omit to hide it */
	prevDays?: DayBucket[];
};

// ─── the renderer ─────────────────────────────────────────────────────────
export function renderMonthView(opts: MonthViewOptions): Buffer {
	const {
		days, prevDays,
		serverName, initials,
		subtitle = '# Messages · last 30 days',
		timezone = 'UTC',
		lookback = 'Last 30 days',
	} = opts;

	const { canvas, ctx } = CreateFrame(HEIGHT);

	const totals = DayTotals(days);
	const grand = SumHours(totals);

	// hourly profile, averaged per day
	const profile = new Array<number>(24).fill(0);
	for (const day of days) {
		for (const [i, v] of day.hours.entries()) profile[i] += v / days.length;
	}

	// weekday averages
	const dowSum = new Array<number>(7).fill(0), dowCount = new Array<number>(7).fill(0);
	for (const [i, day] of days.entries()) {
		const k = day.date.getUTCDay();
		dowSum[k] += totals[i];
		dowCount[k]++;
	}
	const dowAvg = dowSum.map((v, i) => Math.round(v / (dowCount[i] || 1)));
	const dowMax = Math.max(1, ...dowAvg);

	// ── header
	const cards: StatCard[] = [
		{ label: 'MESSAGES', value: grand.toLocaleString(), color: COLORS.text },
		{ label: 'PEAK HOUR', value: FormatHour(profile.indexOf(Math.max(...profile))), color: COLORS.accent300 },
	];
	if (prevDays) {
		const pct = PercentChange(SumHours(DayTotals(prevDays)), grand);
		cards.push({ label: 'VS PREV 30D', value: `${pct >= 0 ? '+' : ''}${pct}%`, color: COLORS.accent300 });
	}
	DrawHeader(ctx, { serverName, initials, subtitle, cards });

	FadedRule(ctx, RULE_1_Y);

	// ── section head + inline legend
	const shBase = SECTION_HEAD_Y + 13;
	let lx = PAD_X;
	DrawText(ctx, 'Messages per day', lx, shBase, '500 13px Inter', COLORS.n200);
	lx += ctx.measureText('Messages per day').width + 18;

	RoundRect(ctx, lx, shBase - 9, 9, 9, 2);
	ctx.fillStyle = COLORS.accent600;
	ctx.fill();
	DrawText(ctx, 'Daily total', lx + 16, shBase, '400 11px Inter', COLORS.n500);
	lx += 16 + ctx.measureText('Daily total').width + 18;

	ctx.fillStyle = COLORS.accent300;
	ctx.fillRect(lx, shBase - 5, 14, 2);
	DrawText(ctx, '7-day average', lx + 21, shBase, '400 11px Inter', COLORS.n500);
	DrawText(ctx, 'Weekends tinted', WIDTH - PAD_X, shBase, '400 11px Inter', COLORS.n600, 'right');

	// ── daily-total chart
	const unit = NiceUnit(Math.max(1, ...totals), CHART_LINES);
	const yTop = unit * CHART_LINES;
	const cy = (v: number) => CHART_BASE - (v / yTop) * CHART_H;
	const slot = CHART_W / days.length;
	const barW = slot * 0.62;
	const cxAt = (i: number) => CHART_X + slot * i + slot / 2;

	// contiguous weekend bands — fewer edges to read than per-day tints
	ctx.fillStyle = COLORS.weekendBand;
	let bandStart = -1;
	for (const [i, day] of days.entries()) {
		const weekend = IsWeekend(day.date);
		if (weekend && bandStart < 0) bandStart = i;
		if (weekend && (i === days.length - 1 || !IsWeekend(days[i + 1].date))) {
			ctx.fillRect(CHART_X + bandStart * slot, CHART_TOP, (i - bandStart + 1) * slot, CHART_H);
			bandStart = -1;
		}
	}

	ctx.strokeStyle = COLORS.gridFaint;
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (let k = 1; k <= CHART_LINES; k++) {
		const gy = Math.round(cy(unit * k)) + 0.5;
		ctx.moveTo(CHART_X, gy);
		ctx.lineTo(CHART_X + CHART_W, gy);
	}
	ctx.stroke();

	ctx.strokeStyle = COLORS.axis;
	ctx.beginPath();
	ctx.moveTo(CHART_X, CHART_BASE + 0.5);
	ctx.lineTo(CHART_X + CHART_W, CHART_BASE + 0.5);
	ctx.stroke();

	for (let k = 1; k <= CHART_LINES; k++) {
		DrawText(ctx, Math.round(unit * k).toLocaleString(), CHART_X - 10, cy(unit * k) + 3.5, '400 10px Inter', COLORS.n600, 'right');
	}

	const peakIdx = totals.indexOf(Math.max(...totals));
	for (const [i, day] of days.entries()) {
		const h = Math.max(2, CHART_BASE - cy(totals[i]));
		RoundRect(ctx, cxAt(i) - barW / 2, CHART_BASE - h, barW, h, 2);
		ctx.fillStyle = i === peakIdx ? COLORS.barPeak : (IsWeekend(day.date) ? COLORS.barWeekend : COLORS.barWeekday);
		ctx.fill();
	}

	// 7-day trailing average
	SmoothPath(ctx, RollingAverage(totals, 6, 0), cxAt, cy);
	ctx.strokeStyle = COLORS.accent300;
	ctx.lineWidth = 2.2;
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.stroke();

	// date labels under each bar
	for (const [i, day] of days.entries()) {
		const weekend = IsWeekend(day.date);
		DrawText(ctx, String(day.date.getUTCDate()), cxAt(i), CHART_TOP + 288, '400 10px Inter', weekend ? COLORS.n400 : COLORS.n600, 'center');
		DrawText(ctx, DAY_NAMES[day.date.getUTCDay()][0], cxAt(i), CHART_TOP + 300.5, '400 10px Inter', COLORS.n700, 'center');
	}

	// busiest-day pill
	{
		const peakDate = days[peakIdx].date;
		const label = `${totals[peakIdx].toLocaleString()} · ${peakDate.getUTCDate()} ${MONTH_NAMES[peakDate.getUTCMonth()]}`;
		ctx.font = '400 10px Inter';
		const pillW = ctx.measureText(label).width + 14, pillH = 17;
		const px = cxAt(peakIdx) - pillW / 2, py = cy(totals[peakIdx]) - 26;
		RoundRect(ctx, px, py, pillW, pillH, 4);
		ctx.fillStyle = COLORS.accent900;
		ctx.fill();
		ctx.strokeStyle = COLORS.accent700;
		ctx.lineWidth = 1;
		ctx.stroke();
		DrawText(ctx, label, px + 7, py + 12, '400 10px Inter', COLORS.accent200);
	}

	FadedRule(ctx, RULE_2_Y);

	// ── panel: time of day
	DrawText(ctx, 'Time of day', PAD_X, PANEL_HEAD_Y + 13, '500 13px Inter', COLORS.n200);
	DrawText(ctx, 'averaged across 30 days', PAD_X + PANEL_W, PANEL_HEAD_Y + 13, '400 11px Inter', COLORS.n600, 'right');

	const hx = (i: number) => PAD_X + (i / 23) * PANEL_W;
	const hourMax = Math.max(1, ...profile);
	const hy = (v: number) => PANEL_BASE - (v / hourMax) * (PANEL_H - 4);

	ctx.strokeStyle = COLORS.gridFaint;
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (const hour of [6, 18]) {
		const gx = Math.round(hx(hour)) + 0.5;
		ctx.moveTo(gx, PANEL_TOP);
		ctx.lineTo(gx, PANEL_BASE);
	}
	ctx.stroke();

	ctx.strokeStyle = COLORS.gridStrong;
	ctx.beginPath();
	const noonX = Math.round(hx(12)) + 0.5;
	ctx.moveTo(noonX, PANEL_TOP);
	ctx.lineTo(noonX, PANEL_BASE);
	ctx.stroke();

	ctx.strokeStyle = COLORS.axis;
	ctx.beginPath();
	ctx.moveTo(PAD_X, PANEL_BASE + 0.5);
	ctx.lineTo(PAD_X + PANEL_W, PANEL_BASE + 0.5);
	ctx.stroke();

	SmoothPath(ctx, profile, hx, hy);
	ctx.lineTo(hx(23), PANEL_BASE);
	ctx.lineTo(hx(0), PANEL_BASE);
	ctx.closePath();
	ctx.fillStyle = AccentGradient(ctx, PANEL_TOP, PANEL_BASE, 0.4, 0.05);
	ctx.fill();

	SmoothPath(ctx, profile, hx, hy);
	ctx.strokeStyle = COLORS.accent;
	ctx.lineWidth = 2;
	ctx.stroke();

	DrawHourTicks(ctx, hx, PANEL_TOP + 119, '400 10px Inter');

	// ── panel: by weekday
	DrawText(ctx, 'By weekday', PANEL_R_X, PANEL_HEAD_Y + 13, '500 13px Inter', COLORS.n200);
	DrawText(ctx, 'average per day', PANEL_R_X + PANEL_W, PANEL_HEAD_Y + 13, '400 11px Inter', COLORS.n600, 'right');

	const colW = (PANEL_W - DOW_GAP * 6) / 7;
	for (const [i, k] of DOW_ORDER.entries()) {
		const x = PANEL_R_X + i * (colW + DOW_GAP);
		const h = Math.max(3, (dowAvg[k] / dowMax) * 82);
		const weekend = k === 0 || k === 6;

		TopRoundRect(ctx, x, PANEL_BASE - h, colW, h, 3);
		ctx.fillStyle = dowAvg[k] === dowMax ? COLORS.barPeak : (weekend ? COLORS.barWeekend : COLORS.barWeekday);
		ctx.fill();

		DrawText(ctx, dowAvg[k].toLocaleString(), x + colW / 2, PANEL_BASE - h - 9.9, '500 11px Inter', COLORS.n300, 'center');
		DrawText(ctx, DAY_NAMES[k], x + colW / 2, PANEL_BASE + 16, '400 10px Inter', weekend ? COLORS.n400 : COLORS.n600, 'center');
	}

	DrawFooter(ctx, {
		ruleY: RULE_3_Y,
		baseline: FOOTER_BASELINE,
		lookback, timezone,
		note: 'Busiest day labelled — hourly detail lives in the 7-day view',
	});

	ctx.restore();
	return canvas.toBuffer('image/png');
}