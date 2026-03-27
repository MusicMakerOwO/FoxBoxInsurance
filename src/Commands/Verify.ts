import { CommandHandler } from "../Typings/HandlerTypes";
import { COLOR, RandomLoadingEmbed } from "../Utils/Constants";
import { SlashCommandBuilder } from "discord.js";
import { Database } from "../Database";
import { Log } from "../Utils/Log";
import { createHash } from "node:crypto";
import { APIEmbed } from "discord-api-types/v10";

const FailedEmbed = {
	color      : COLOR.ERROR,
	description: 'Failed to download file'
}
const NoExportEmbed = {
	color      : COLOR.ERROR,
	description: 'No export found with that ID'
}
const ModifiedEmbed = {
	color      : COLOR.ERROR,
	description: 'The export has been modified - Check you have the correct export ID'
}
const CleanEmbed = {
	color      : COLOR.SUCCESS,
	description: 'This export is clean - No modifications detected'
}

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'reply',
	hidden        : true,

	usage   : '/verify <file> <export_id>',
	examples: [
		'/verify <file> AAAA-BBBB-CCCC-DDDD'
	],
	data    : new SlashCommandBuilder()
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
	execute : async function (interaction) {
		const exportID = interaction.options.getString('export_id')!;
		const file = interaction.options.getAttachment('file')!;

		const storedHash = await Database.query(`
            SELECT hash
            FROM Exports
            WHERE id = ?`, [exportID])
		.then(x => x[0]?.hash) as string | null;
		if (!storedHash) {
			return { embeds: [NoExportEmbed] };
		}

		let fileData: string;
		try {
			const request = await fetch(file.url);
			fileData = await request.text();
		} catch (err) {
			Log('ERROR', err);
			return { embeds: [FailedEmbed] };
		}

		// @ts-expect-error
		void interaction.editReply({ embeds: [RandomLoadingEmbed()] });
		await new Promise(resolve => setTimeout(resolve, 2000));

		let embed: APIEmbed = CleanEmbed;

		const hash = createHash('sha1')
		.update(fileData)
		.digest('hex');
		if (hash !== storedHash) {
			embed = ModifiedEmbed;
		}

		return { embeds: [embed] };
	}
} satisfies CommandHandler as CommandHandler;