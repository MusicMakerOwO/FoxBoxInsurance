import {ButtonHandler} from "../../Typings/HandlerTypes";
import { COLOR, FORMAT, FORMAT_EMOJIS } from "../../Utils/Constants";
import {GetExportCache} from "../../Utils/Caching/GetExportCache";
import {ObjectValues} from "../../Typings/HelperTypes";
import { TOS_FEATURES } from "../../TOSConstants";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes";

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'export-format',
	execute       : async function(interaction, client, args) {
		// @ts-expect-error
		const exportOptions = await GetExportCache(interaction);
		if (!exportOptions) return {};

		const selection = args[0];

		if (selection) {
			exportOptions.format = parseInt(selection) as ObjectValues<typeof FORMAT>;
			client.exportCache.set(
				`export_${interaction.guildId}_${interaction.channelId}_${interaction.user.id}`,
				exportOptions
			);
		}

		return {
			embeds: [{
				color: COLOR.PRIMARY,
				description: `
${FORMAT_EMOJIS[FORMAT.TEXT]} **Text**
Universal, Basic format, easy to read, but that's it.
__Pros__: Easy to read, universal format
__Cons__: No images

${FORMAT_EMOJIS[FORMAT.JSON]} **JSON**
Not readable but perfect tool for developers and server analytics!
__Pros__: Structured, easy data analysis
__Cons__: Not readable, images are links

${FORMAT_EMOJIS[FORMAT.HTML]} **HTML**
Looks just like discord, not compatible with mobile devices. Pictures and videos are included!
__Pros__: Very human friendly, images are included
__Cons__: Not compatible with mobile devices
`
			}],
			components: [{
				type: 1,
				components: [{
						type     : 2,
						label: 'Text',
						custom_id: `export-format_${FORMAT.TEXT}`,
						emoji: { name: FORMAT_EMOJIS[FORMAT.TEXT] },
						style    : exportOptions.format === FORMAT.TEXT ? 3 : 2,
						disabled : exportOptions.format === FORMAT.TEXT
					},
					{
						type     : 2,
						label: 'JSON',
						custom_id: `export-format_${FORMAT.JSON}`,
						emoji: { name: FORMAT_EMOJIS[FORMAT.JSON] },
						style    : exportOptions.format === FORMAT.JSON ? 3 : 2,
						disabled : exportOptions.format === FORMAT.JSON
					},
					{
						type     : 2,
						label: 'HTML',
						custom_id: `export-format_${FORMAT.HTML}`,
						emoji: { name: FORMAT_EMOJIS[FORMAT.HTML] },
						style    : exportOptions.format === FORMAT.HTML ? 3 : 2,
						disabled : exportOptions.format === FORMAT.HTML
					}
				]
			}, {
				type: 1,
				components: [{
					type: 2,
					style: 4,
					label: 'Back',
					custom_id: 'export-main'
				}]
			}]
		};
	}
} satisfies ButtonHandler as ButtonHandler;