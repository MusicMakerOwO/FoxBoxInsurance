import { ButtonHandler } from "../Typings/HandlerTypes.js";
import { Axis, RenderGraph } from "../Utils/Activity/GraphCreator.js";
import { AggregateMessageHistory } from "../Utils/Activity/AggregateMessageHistory.js";
import { COLOR, SECONDS } from "../Utils/Constants.js";
import { DiscordActionRow, DiscordButton } from "../Typings/DiscordTypes.js";

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

function Convert24To12(time: number) {
	if (time === 0) return '12 AM';
	if (time < 12) return `${time} AM`;
	if (time === 12) return '12 PM';
	return `${time - 12} PM`;
}

export default {
	tos_features: [],
	guild_features: [],
	permissions: [],
	response_type: 'update',
	hidden: false,
	customID: 'activity',
	execute: async function (interaction, client, args) {
		const timeSpan = args[0];
		if (timeSpan !== 'day' && timeSpan !== 'week' && timeSpan !== 'month' && timeSpan !== 'year') {
			throw new Error(`Invalid time interval: ${timeSpan}`);
		}

		const axes: Axis[] = [];

		switch (timeSpan) {
			case 'day': {
				const now = new Date();
				const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
				const buckets = await AggregateMessageHistory({
					guildID: BigInt(interaction.guildId!),
					channelID: null,
					timeRange: [
						startOfToday - SECONDS.WEEK * 1000,
						Date.now()
					],
					bucketSize: SECONDS.DAY / 4
				});

				const points = buckets.map(point => ({
					value: point.count,
					label: Convert24To12(new Date(point.start).getUTCHours())
				}));

				axes.push({
					label: "Hourly",
					color: COLOR.PRIMARY,
					points: points,
					tilt: true,
				});

				break;
			}
			case 'week': {
				const now = new Date();
				const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
				const buckets = await AggregateMessageHistory({
					guildID: BigInt(interaction.guildId!),
					channelID: null,
					timeRange: [
						startOfToday - SECONDS.WEEK * 2 * 1000,
						Date.now()
					],
					bucketSize: SECONDS.DAY
				});

				const points = buckets.map(point => ({
					value: point.count,
					label: Month[new Date(point.start).getUTCMonth()] + ' ' + new Date(point.start).getUTCDate()
				}));

				axes.push({
					label: "Daily",
					color: COLOR.PRIMARY,
					points: points,
					tilt: false,
				});

				break;
			}
			case 'month': {
				const now = new Date();
				const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
				const buckets = await AggregateMessageHistory({
					guildID: BigInt(interaction.guildId!),
					channelID: null,
					timeRange: [
						startOfToday - SECONDS.MONTH * 1000,
						Date.now()
					],
					bucketSize: SECONDS.DAY
				});

				const points = buckets.map((point, index) => ({
					value: point.count,
					label: index % 7 === 0
						? Month[new Date(point.start).getUTCMonth()] + ' ' + new Date(point.start).getUTCDate()
						: ''
				}));

				axes.push({
					label: "Daily",
					color: COLOR.PRIMARY,
					points: points,
					tilt: false,
				});

				break;
			}
			case 'year': {
				const now = new Date();
				const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
				const buckets = await AggregateMessageHistory({
					guildID: BigInt(interaction.guildId!),
					channelID: null,
					timeRange: [
						startOfToday - SECONDS.YEAR * 1000,
						Date.now()
					],
					bucketSize: SECONDS.MONTH
				});

				const points = buckets.map(point => ({
					value: point.count,
					label: new Date(point.start).toLocaleString('en-US', { month: 'short' })
				}));

				axes.push({
					label: "Monthly",
					color: COLOR.PRIMARY,
					points: points,
					tilt: false,
				});

				break;
			}
			default:
				throw new Error(`Invalid time interval: ${timeSpan}`);
		}

		if (axes.length === 0 || axes.length > 2) throw new Error(`Wrong number of axes, must only have 1 or 2 displayed - found ${axes.length}`);

		const image = RenderGraph({
			title: "Message History",
			// @ts-expect-error | Invalid length, checked above
			axes: axes
		});

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
					label: "Day",
					custom_id: 'activity_day',
					style: timeSpan === 'day' ? 3 : 2,
					disabled: timeSpan === 'day'
				}
			]
		}

		return {
			files: [{
				attachment: image,
				name: 'history.png'
			}],
			components: [ buttons ]
		}
	}
} satisfies ButtonHandler as ButtonHandler;