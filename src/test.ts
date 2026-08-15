import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));

import * as dotenv from "dotenv";
dotenv.config({ path: `${__dirname}/../.env` });

import { Database } from "./Database.js";
import { AggregateMessageHistory } from "./Utils/Activity/AggregateMessageHistory.js";
import { SECONDS } from "./Utils/Constants.js";
import { RenderGraph } from "./Utils/Activity/GraphCreator.js";
import { writeFileSync } from "node:fs";

const DaysOfWeek = [
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
	'Sunday'
];

function Convert24To12(time: number) {
	if (time === 0) return '12 AM';
	if (time < 12) return `${time} AM`;
	if (time === 12) return '12 PM';
	return `${time - 12} PM`;
}

void ( async() => {
	const now = new Date();
	const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

	console.time("aggregate");
	const dailyPoints = await AggregateMessageHistory({
		guildID: 717942553617498122n,
		channelID: null,
		timeRange: [
			startOfToday - SECONDS.WEEK * 1000,
			Date.now()
		],
		bucketSize: SECONDS.DAY
	});
	const quarterlyPoints = await AggregateMessageHistory({
		guildID: 717942553617498122n,
		channelID: null,
		timeRange: [
			startOfToday - SECONDS.WEEK * 1000,
			Date.now()
		],
		bucketSize: SECONDS.DAY / 4
	});
	console.timeEnd("aggregate");

	console.time("convert");
	const dailyGraphPoints = dailyPoints.map(point => ({
		value: point.count,
		label: DaysOfWeek[ new Date(point.start).getUTCDay() ]
	}));
	const quarterlyGraphPoints = quarterlyPoints.map(point => ({
		value: point.count,
		label: Convert24To12( new Date(point.start).getUTCHours() )
	}));
	console.timeEnd("convert");

	void Database.destroy();

	console.time("render");
	const image = RenderGraph({
		title: "Message History",
		axes: [
			{
				label: "Hourly",
				color: 0xff7700,
				points: quarterlyGraphPoints,
				tilt: true,
			},
			{
				label: "Daily",
				color: 0xff0000,
				points: dailyGraphPoints,
				tilt: false,
			},
			// {
			// 	label: "Data 2",
			// 	color: 0x00ffff,
			// 	points: new Array(20).fill({}).map(_ => ({ value: ~~(Math.random() * 20) }) ).map(x => ({ ... x, label: x.value.toString() }))
			// },
			// {
			// 	label: "Data 1",
			// 	color: 0xff0000,
			// 	points: new Array(10).fill({}).map(_ => ({ value: ~~(Math.random() * 20) }) ).map(x => ({ ... x, label: x.value.toString() }))
			// },
		]
	});
	console.timeEnd("render");

	writeFileSync(`${__dirname}/../image.png`, image);
})();