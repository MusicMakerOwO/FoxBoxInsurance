const { EMOJI } = require("../../../Utils/Constants");
const { CancelJob } = require("../../../Utils/Parsers/RestoreJobs");

const NotOwnerEmbed = {
	color: 0xFF0000,
	title: `${EMOJI.WARNING} Missing Permissions`,
	description: 'You must be the server owner to cancel a snapshot restore',
}

const CancelEmbed = {
	color: 0xFF0000,
	title: `${EMOJI.DELETE} Restore Cancelled`,
	description: 'The server restore has been cancelled\nThe damage cannot be undone however',
};

module.exports = {
	customID: 'restore-cancel',
	execute: async function(interaction, client, args) {
		const jobID = parseInt(args[0]) || 0;
		if (isNaN(jobID) || jobID < 0) throw new Error(`Invalid job ID provided : ${args[0]}`);

		if (interaction.user.id !== interaction.guild.ownerId) {
			return interaction.reply({
				embeds: [NotOwnerEmbed],
				ephemeral: true
			});
		}

		try {
			CancelJob(jobID);
		} catch (error) {
			// ignore lol
		}

		return interaction.update({
			embeds: [CancelEmbed],
			components: []
		});
	}
}