const GetExportCache = require("../../Utils/Caching/GetExportCache");
const { FORMAT, COLOR } = require("../../Utils/Constants");

const FORMAT_EMBED = {
	color: COLOR.PRIMARY,
	description: `
📄 **Text**
Basic format, easy to read but that's it.
__Pros__: Easy to read, universal format
__Cons__: No images

🗂️ **JSON**
Structured format, easy to parse but not human readable.
__Pros__: Structured, easy data analysis
__Cons__: Not human readable, images are links

📊 **CSV**
Structured format, easy to parse and mostly human readable.
__Pros__: Easy data analysis, human readable
__Cons__: No images

🌐 **HTML**
Looks just like discord, not compatible with mobile devices
__Pros__: Very human friendly, images are included
__Cons__: Not compatible with mobile devices
`
}

const FORMAT_BUTTONS = {
	[FORMAT.TEXT]: {
		label: 'Text',
		custom_id: `export-format_${FORMAT.TEXT}`,
		emoji: '📄'
	},
	[FORMAT.JSON]: {
		label: 'JSON',
		custom_id: `export-format_${FORMAT.JSON}`,
		emoji: '🗂️'
	},
	[FORMAT.CSV]: {
		label: 'CSV',
		custom_id: `export-format_${FORMAT.CSV}`,
		emoji: '📊'
	},
	[FORMAT.HTML]: {
		label: 'HTML',
		custom_id: `export-format_${FORMAT.HTML}`,
		emoji: '🌐'
	}
}

const BACK_BUTTON = {
	type: 1,
	components: [{
		type: 2,
		style: 4,
		label: 'Back',
		custom_id: 'export-main'
	}]
}

module.exports = {
	customID: 'export-format',
	execute: async function(interaction, client, args) {

		const selection = args[0];

		const exportOptions = await GetExportCache(client, interaction);
		if (!exportOptions) return;

		await interaction.deferUpdate().catch(() => {});

		if (selection) {
			exportOptions.format = selection;
			client.ttlcache.set(
				`export_${interaction.guildId}_${interaction.channelId}_${interaction.user.id}`,
				exportOptions
			);
		}

		const buttons = {
			type: 1,
			components: []
		}

		for (const [key, value] of Object.entries(FORMAT_BUTTONS)) {
			buttons.components.push({
				...value,
				type: 2,
				style: exportOptions.format === key ? 3 : 2,
				disabled: exportOptions.format === key
			});
		}

		interaction.editReply({ embeds: [FORMAT_EMBED], components: [buttons, BACK_BUTTON] });

	}
}