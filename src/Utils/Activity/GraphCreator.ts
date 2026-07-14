import { createCanvas, CanvasRenderingContext2D } from 'canvas';

export type Point = {
	value: number;
	label?: string;
}

export type Axis = {
	/** 0x000000 -> 0xFFFFFF */
	color: number;
	label: string;
	points: Point[];
	min?: number;
	max?: number;
	tilt: boolean;
}

export type GraphOptions = {
	axes: [Axis] | [Axis, Axis]
	title: string;
}

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 650;
const PADDING = 80;

const GRAPH_WIDTH = CANVAS_WIDTH - 2 * PADDING;
const GRAPH_HEIGHT = CANVAS_HEIGHT - 2 * PADDING - 40; // Extra space for horizontal labels

/**
 * Renders a line graph to PNG based on GraphOptions
 * @param options - Graph configuration
 * @returns PNG image as Buffer
 */
export function RenderGraph(options: GraphOptions): Buffer {
	const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
	const ctx = canvas.getContext('2d');

	// Fill background
	ctx.fillStyle = '#1c1a19';
	ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

	// Draw title
	if (options.title) {
		ctx.font = `bold 40px Arial`;
		ctx.fillStyle = '#ff4800';
		ctx.textAlign = 'center';
		ctx.fillText(options.title, CANVAS_WIDTH / 2, 50);
	}

	// Draw axes
	ctx.strokeStyle = '#ffffff';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(PADDING, PADDING);
	ctx.lineTo(PADDING, CANVAS_HEIGHT - PADDING - 50);
	ctx.lineTo(CANVAS_WIDTH - PADDING, CANVAS_HEIGHT - PADDING - 50);
	ctx.stroke();

	const axis0 = options.axes[0];
	const axis1 = options.axes[1];

	// Calculate scale and bounds
	const axisScale0 = calculateScale(axis0.points, axis0.min, axis0.max);
	const axisScale1 = axis1 ? calculateScale(axis1.points, axis1.min, axis1.max) : null;

	const scale: Scale = {
		min: axisScale1 ? Math.min(axisScale0.min, axisScale1.min) : axisScale0.min,
		max: axisScale1 ? Math.max(axisScale0.max, axisScale1.max) : axisScale0.max,
		range: 0 // see below
	}
	scale.range = scale.max - scale.min;

	// Draw Y-axis labels and grid for axis 0
	drawYAxisLabels(ctx, scale, PADDING, CANVAS_HEIGHT - PADDING - 50, GRAPH_HEIGHT - 50, '#ccc');

	// Draw lines for axis 0
	drawLine(
		ctx,
		axis0,
		scale,
		PADDING,
		CANVAS_HEIGHT - PADDING - 50,
		GRAPH_WIDTH,
		GRAPH_HEIGHT - 50,
		false
	);

	// Draw lines for axis 1 if present
	if (axis1) {
		drawLine(
			ctx,
			axis1,
			scale,
			PADDING,
			CANVAS_HEIGHT - PADDING - 50,
			GRAPH_WIDTH,
			GRAPH_HEIGHT - 50,
			true
		);
	}

	// Draw legend
	drawLegend(ctx, [axis0, axis1].filter((a) => a !== undefined) as Axis[]);

	return canvas.toBuffer('image/png');
}

interface Scale {
	min: number;
	max: number;
	range: number;
}

function calculateScale(values: Point[], minOverride?: number, maxOverride?: number): Scale {
	const min = minOverride !== undefined ? minOverride : Math.min(...values.map(x => x.value), 0);
	const max = maxOverride !== undefined ? maxOverride : Math.max(...values.map(x => x.value), 1);
	return {
		min,
		max,
		range: max - min,
	};
}

function drawYAxisLabels(
	ctx: CanvasRenderingContext2D,
	scale: Scale,
	x: number,
	y: number,
	height: number,
	gridColor: string
): void {
	ctx.font = `16px Arial`;
	ctx.fillStyle = '#fff';
	ctx.textAlign = 'right';

	const steps = 5;
	for (let i = 0; i <= steps; i++) {
		const value = scale.min + (scale.range * i) / steps;
		const yPos = y - (height * i) / steps;

		// Draw grid line
		ctx.strokeStyle = gridColor;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(x, yPos);
		ctx.lineTo(CANVAS_WIDTH - x, yPos);
		ctx.stroke();

		// Draw label
		ctx.fillText(value.toFixed(0), x - 10, yPos + 8);
	}
}

function drawLine(
	ctx: CanvasRenderingContext2D,
	axis: Axis,
	scale: Scale,
	startX: number,
	startY: number,
	width: number,
	height: number,
	second_line: boolean
): void {
	const hexColor = `#${axis.color.toString(16).padStart(6, '0')}`;
	ctx.strokeStyle = hexColor;
	ctx.lineWidth = 2;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';

	if (axis.points.length === 0) return;

	ctx.beginPath();
	for (let i = 0; i < axis.points.length; i++) {
		const point = axis.points[i];
		const xPos = startX + (width * i) / (axis.points.length - 1 || 1);
		const yPos = startY - ((point.value - scale.min) / scale.range) * height;

		if (i === 0) {
			ctx.moveTo(xPos, yPos);
		} else {
			ctx.lineTo(xPos, yPos);
		}
	}
	ctx.stroke();

	// Draw data points
	ctx.fillStyle = hexColor;
	for (let i = 0; i < axis.points.length; i++) {
		const point = axis.points[i];
		const xPos = startX + (width * i) / (axis.points.length - 1 || 1);
		const yPos = startY - ((point.value - scale.min) / scale.range) * height;

		ctx.beginPath();
		ctx.arc(xPos, yPos, 4, 0, Math.PI * 2);
		ctx.fill();
	}

	// Add labels beneath the graph
	ctx.fillStyle = `#${axis.color.toString(16).padStart(6, '0')}`;
	ctx.textAlign = axis.tilt ? 'right' : 'center';
	ctx.font = `16px Arial`;
	for (let i = 0; i < axis.points.length; i++) {
		const point = axis.points[i];
		if (!point.label) continue;

		const xPos = startX + (width * i) / (axis.points.length - 1 || 1) + (axis.tilt ? 15 : 0);

		ctx.save();
		ctx.translate(xPos, second_line ? 620 : 550);
		if (axis.tilt) ctx.rotate(-Math.PI / 4); // 45 degrees
		ctx.fillText(point.label, 0, 0)
		ctx.restore();
	}
}

function drawLegend(ctx: CanvasRenderingContext2D, axes: Axis[]): void {
	if (axes.length === 0) return;

	const legendX = CANVAS_WIDTH - 200;
	const legendY = 50;
	const itemHeight = 25;

	ctx.font = `24px Arial`;

	for (let i = 0; i < axes.length; i++) {
		const axis = axes[i];
		const hexColor = `#${axis.color.toString(16).padStart(6, '0')}`;
		const y = legendY + i * itemHeight;

		// Color box
		ctx.fillStyle = hexColor;
		ctx.fillRect(legendX, y - 10, 20, 20);

		// Label
		ctx.fillStyle = '#ffffff';
		ctx.textAlign = 'left';
		ctx.fillText(axis.label, legendX + 26, y + 8);
	}
}