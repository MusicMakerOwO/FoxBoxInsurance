const { AttachmentBuilder } = require("discord.js");
const GetExportCache = require("../Utils/Caching/GetExportCache");
const { COLOR } = require("../Utils/Constants");
const Export = require("../Utils/Parsers/Export");
const { DownloadAssets } = require("../Utils/Processing/Images");
const LinkAssets = require("../Utils/Processing/LinkAssets");

const ProcessMessages = require("../Utils/Processing/Messages");

const LoadingEmbed = {
	color: COLOR.PRIMARY,
	description: 'Exporting - This may take a minute...'
}

module.exports = {
	customID: 'export-finish',
	execute: async function(interaction, client, args) {
		const exportOptions = await GetExportCache(client, interaction);
		if (!exportOptions) return;
		
		// this could take a while...
		await interaction.deferUpdate().catch(() => {});
		await interaction.editReply({ embeds: [LoadingEmbed], components: [] });

		// flush all the caches first to make sure we have the latest data
		// We don't want any missing assets or holes in the data
		ProcessMessages(client.messageCache); // save messages
		await DownloadAssets(); // download files
		LinkAssets(); // link tables together

		const file = await Export(exportOptions); // { name: string, data: Buffer }

		const attachment = {
			attachment: file.data,
			name: file.name
		};

		await interaction.editReply({
			content: 'Export complete!',
			embeds: [],
			files: [attachment]
		});

	}
}