const { COLOR, STATUS_EMOJI } = require("../../Utils/Constants");
const { FetchSnapshot, FetchAllBans } = require("../../Utils/SnapshotUtils");

const LOADING_STEPS = [
	'Loading snapshot data ...', // fetch snapshot
	'Reading current server data ...', // fetch current server data
	'Making a plan ...', // find the best way to restore
	'Getting ready ...' // prepare for restore, ask for confirmation
];

function LoadingEmbed(snapshotID, step, times = []) {
	const embed = {
		color: COLOR.PRIMARY,
		title: `Restoring snapshot #${snapshotID}`,
		description: ''
	};
	for (let i = 0; i < LOADING_STEPS.length; i++) {
		if (i < step) {
			embed.description += `${STATUS_EMOJI.SUCCESS} ${LOADING_STEPS[i]} (${Math.max(times[i], 0.01)}s)\n`;
		} else {
			embed.description += `${STATUS_EMOJI.LOADING} ${LOADING_STEPS[i]}\n`;
		}
	}
	return embed;
}

const ownerEmbed = {
	color: COLOR.ERROR,
	title: 'Missing Permissions',
	description: 'Only the server owner can use this command'
}

module.exports = {
	customID: 'snapshot-restore',
	execute: async function(interaction, client, args) {

		if (interaction.user.id !== interaction.guild.ownerId) {
			return interaction.reply({ embeds: [ownerEmbed], ephemeral: true });
		}

		const snapshotID = parseInt(args[0]);

		if (isNaN(snapshotID) || snapshotID <= 0) throw new Error('Invalid snapshot ID provided.');

		await interaction.deferUpdate({ ephemeral: true });

		await interaction.editReply({
			embeds: [ LoadingEmbed(snapshotID, 0) ],
			components: []
		});

		const snapshotStart = Date.now();
		const SnapshotData = FetchSnapshot(snapshotID);
		if (!SnapshotData) throw new Error(`Snapshot with ID ${snapshotID} not found.`);
		const snapshotEnd = Date.now();
		const snapshotTime = (snapshotEnd - snapshotStart) / 1000; // in seconds

		await interaction.editReply({
			embeds: [ LoadingEmbed(snapshotID, 1, [snapshotTime ]) ],
			components: []
		});

		const currentStart = Date.now();
		const GuildChannels = Array.from( interaction.guild.channels.cache.values() );
		const GuildRoles = Array.from( interaction.guild.roles.cache.values() );
		const GuildBans = Array.from( (await FetchAllBans(interaction.guild) ).values() );
		const currentEnd = Date.now();
		const currentTime = (currentEnd - currentStart) / 1000; // in seconds

		await interaction.editReply({
			embeds: [ LoadingEmbed(snapshotID, 2, [snapshotTime, currentTime ]) ],
			components: []
		});


	}
}