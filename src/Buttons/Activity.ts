import { ButtonHandler, InteractionResponse } from "../Typings/HandlerTypes.js";
import { renderDayRows, DayBucket as WeekDayBucket } from "../Utils/Activity/render-day-rows.js";
import { renderMonthView, DayBucket as MonthDayBucket } from "../Utils/Activity/render-month-view.js";
import { renderYearView, DayBucket as YearDayBucket } from "../Utils/Activity/render-year-view.js";
import { AggregateMessageHistory } from "../Utils/Activity/AggregateMessageHistory.js";
import { SECONDS } from "../Utils/Constants.js";
import { DiscordActionRow, DiscordButton } from "../Typings/DiscordTypes.js";
import { GetTimezone } from "../CRUD/UserTimezones.js";
import { TimezoneLabel } from "../Utils/Timezones.js";
import { ZonedDate, ZonedDayStarts } from "../Utils/ZonedTime.js";

const Month = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];

const DayOfWeek = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday'
];

/**
 * Builds one bucket per local day, each with 24 hourly slots, filled from hourly points.
 *
 * `dayStarts` are local midnights from `ZonedDayStarts`, so the days they delimit are 23, 24 or 25
 * hours long across a daylight saving transition. The `hours` array every renderer expects is a
 * fixed 24 slots, so those two days a year are lossy at the edge: a 25 hour day folds its extra
 * hour into slot 23, and a 23 hour day leaves one slot empty.
 */
export function buildDayBuckets(dayStarts: number[], zone: string, buckets: { start: number, count: number }[]): { date: Date, hours: number[] }[] {
	const days = dayStarts.map(start => ({
		date: ZonedDate(zone, start),
		hours: new Array(24).fill(0)
	}));

	// Points arrive ordered, so one pointer walks the boundaries alongside them
	let dayIndex = 0;
	for (const point of buckets) {
		if (point.start < dayStarts[0]) continue;
		while (dayIndex + 1 < dayStarts.length && point.start >= dayStarts[dayIndex + 1]) dayIndex++;

		const hourIndex = Math.floor((point.start - dayStarts[dayIndex]) / (SECONDS.HOUR * 1000));
		if (hourIndex > 24) continue; // past the end of the last day

		days[dayIndex].hours[Math.min(hourIndex, 23)] += point.count;
	}

	return days;
}

export default {
	tos_features: [],
	guild_features: [],
	permissions: [],
	response_type: 'update',
	hidden: false,
	customID: 'activity',
	execute: async function (interaction, client, args): Promise<InteractionResponse> {
		const timeSpan = args[0];
		if (timeSpan !== 'week' && timeSpan !== 'month' && timeSpan !== 'year') {
			throw new Error(`Invalid time interval: ${timeSpan}`);
		}

		const serverName = interaction.guild?.name ?? "Message History";
		const initials = (interaction.guild?.name ?? "MH").slice(0, 2).toUpperCase();

		const userTimezone = await GetTimezone(interaction.user.id);
		const timezoneLabel = TimezoneLabel(userTimezone, Date.now());

		let image: Buffer;

		// Every boundary below is a local midnight in the user's zone, not a UTC one - the renderers
		// document their hour slots as "index 0 = 00:00 local" and the footer names the zone.
		switch (timeSpan) {
			case 'week': {
				const dayStarts = ZonedDayStarts(userTimezone, Date.now(), 7);
				const buckets = await AggregateMessageHistory({
					guildID: BigInt(interaction.guildId!),
					channelID: null,
					timeRange: [
						dayStarts[0],
						Date.now()
					],
					bucketSize: SECONDS.HOUR
				});

				const days: WeekDayBucket[] = buildDayBuckets(dayStarts, userTimezone, buckets).map(day => ({
					name: DayOfWeek[day.date.getUTCDay()],
					date: `${day.date.getUTCDate()} ${Month[day.date.getUTCMonth()]}`,
					hours: day.hours
				}));

				image = renderDayRows({
					days,
					serverName,
					initials,
					timezone: timezoneLabel
				});

				break;
			}
			case 'month': {
				const dayStarts = ZonedDayStarts(userTimezone, Date.now(), 30);
				const buckets = await AggregateMessageHistory({
					guildID: BigInt(interaction.guildId!),
					channelID: null,
					timeRange: [
						dayStarts[0],
						Date.now()
					],
					bucketSize: SECONDS.HOUR
				});

				const days: MonthDayBucket[] = buildDayBuckets(dayStarts, userTimezone, buckets);

				image = renderMonthView({
					days,
					serverName,
					initials,
					timezone: timezoneLabel
				});

				break;
			}
			case 'year': {
				const dayStarts = ZonedDayStarts(userTimezone, Date.now(), 365);
				const buckets = await AggregateMessageHistory({
					guildID: BigInt(interaction.guildId!),
					channelID: null,
					timeRange: [
						dayStarts[0],
						Date.now()
					],
					bucketSize: SECONDS.HOUR
				});

				const days: YearDayBucket[] = buildDayBuckets(dayStarts, userTimezone, buckets);

				image = renderYearView({
					days,
					serverName,
					initials,
					timezone: timezoneLabel
				});

				break;
			}
			default:
				throw new Error(`Invalid time interval: ${timeSpan}`);
		}

		const buttons: DiscordActionRow<DiscordButton> = {
			type: 1,
			components: [
				{
					type: 2,
					label: "Year",
					custom_id: 'activity_year',
					style: timeSpan === 'year' ? 3 : 2,
					disabled: timeSpan === 'year'
				},
				{
					type: 2,
					label: "Month",
					custom_id: 'activity_month',
					style: timeSpan === 'month' ? 3 : 2,
					disabled: timeSpan === 'month'
				},
				{
					type: 2,
					label: "Week",
					custom_id: 'activity_week',
					style: timeSpan === 'week' ? 3 : 2,
					disabled: timeSpan === 'week'
				},
				{
					type: 2,
					label: "|",
					custom_id: 'null',
					style: 2,
					disabled: true
				},
				{
					type: 2,
					label: `Timezone: ${timezoneLabel}`,
					custom_id: `set-timezone_${args.join('_')}`,
					style: 2
				}
			]
		}

		return {
			embeds: [],
			files: [{
				attachment: image,
				name: 'history.png'
			}],
			components: [ buttons ]
		}
	}
} satisfies ButtonHandler as ButtonHandler;