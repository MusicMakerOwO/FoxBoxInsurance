const { SlashCommandBuilder } = require('@discordjs/builders');
const { COLOR } = require('../Utils/Constants');

const embed = {
	color: COLOR.PRIMARY,
	description: `
You can find a copy of the Terms of Service and Priavcy Policy at the respective links below.

**Privacy Policy** : https://notfbi.dev/privacy
**Terms of Service** : https://notfbi.dev/terms

For any privacy concerns or legal troubles please reach out to me on discord \`@musicmaker\` or send an email to \`joshua@ringofsaturn.com\``
}

module.exports = {
	aliases: ['privacy'],
	data: new SlashCommandBuilder()
		.setName('terms')
		.setDescription('View the TOS and privacy policy'),
	execute: async function(interaction, client) {
		await interaction.reply({ embeds: [embed], ephemeral: true });
	}
}