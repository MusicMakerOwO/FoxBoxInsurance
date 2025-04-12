const https = require('https');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { COLOR } = require('../Utils/Constants');
const Database = require('../Utils/Database');

const FailedEmbed = {
	color: COLOR.ERROR,
	description: 'Failed to download file'
}
const NoExportEmbed = {
	color: COLOR.ERROR,
	description: 'No export found with that ID'
}
const ModifiedEmbed = {
	color: COLOR.ERROR,
	description: 'The export has been modified - Check you have the correct export ID'
}
const CleanEmbed = {
	color: COLOR.SUCCESS,
	description: 'This export is clean - No modifications detected'
}
const LoadingEmbed = {
	color: COLOR.PRIMARY,
	description: 'Checking file...'
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('verify')
		.setDescription('Test if an export has been modified')
		.addStringOption(x => x
			.setName('export_id')
			.setDescription('The ID of the export')
			.setRequired(true)
		)
		.addAttachmentOption(x => x
			.setName('file')
			.setDescription('The export in question')
			.setRequired(true)
		),
	execute: async function(interaction, client) {
		const exportID = interaction.options.getString('export_id');
		const file = interaction.options.getAttachment('file');

		await interaction.deferReply({ ephemeral: true }).catch(() => {});

		const storedHash = Database.prepare(`SELECT hash FROM Exports WHERE id = ?`).pluck().get(exportID);
		if (!storedHash) {
			await interaction.editReply({ embeds: [NoExportEmbed] });
			return;
		}

		try {
			var fileData = await Download(file.url);
		} catch (err) {
			await interaction.editReply({ embeds: [FailedEmbed] })
			console.error(err);
			return;
		}

		await interaction.editReply({ embeds: [LoadingEmbed] });
		await new Promise(resolve => setTimeout(resolve, 2000));

		const hash = require('crypto').createHash('sha1').update(fileData).digest('hex');
		if (hash !== storedHash) {
			await interaction.editReply({ embeds: [ModifiedEmbed] });
		} else {
			await interaction.editReply({ embeds: [CleanEmbed] });
		}
	}
}

async function Download(url) {
	return new Promise((resolve, reject) => {
		const request = https.get(url, (response) => {
			if (response.statusCode !== 200) {
				reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
				return;
			}

			const MAX_SIZE = 1024 * 1024 * 100; // 100MB

			const data = [];
			let size = 0;
			response.on('data', (chunk) => {
				size += chunk.length;
				if (size > MAX_SIZE) {
					reject(new Error(`File size exceeds 100MB`));
					return;
				}
				data.push(chunk);
			});
			response.on('end', () => resolve(Buffer.concat(data)));
		});
		request.on('error', (err) => {
			reject(err);
		});
		request.end();
	});
}