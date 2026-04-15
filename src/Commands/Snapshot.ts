import {COLOR, EMOJI, RandomLoadingEmbed, SNAPSHOT_TYPE} from "../Utils/Constants";
import {ButtonInteraction, SlashCommandBuilder} from "discord.js";
import {CommandHandler} from "../Typings/HandlerTypes";
import {GetGuild, SaveGuild} from "../CRUD/Guilds";
import {GUILD_FEATURES} from "../Typings/DatabaseTypes";
import {CreateSnapshot, JSONSnapshot} from "../CRUD/Snapshots";
import {BuildSnapshotFromImport} from "../Utils/Snapshots/Imports/Parse";
import {Log} from "../Utils/Log";
import {SaveImportForGuild} from "../CRUD/SnapshotImports";
import { TOS_FEATURES } from "../TOSConstants";
import { DiscordPermissions } from "../Utils/DiscordConstants";
import { GetFeatureFlag } from "../Services/GuildFeatures";

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [], // GUILD_FEATURES.MANAGE_SNAPSHOTS but checked below, enable and disable commands are included here lol
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'reply',
	hidden        : true,
	aliases       : ['backup'],
	examples      : [
		'/snapshot enabled',
		'/snapshot create',
		'/snapshot list',
		'/snapshot import <file>'
	],
	data          : new SlashCommandBuilder()
		.setName('snapshot')
		.setDescription('Manage server snapshots')
		.addSubcommand(x => x
			.setName('create')
			.setDescription('What a pretty picture :D')
		)
		.addSubcommand(x => x
			.setName('list')
			.setDescription('List all snapshots')
		)
		.addSubcommand(x => x
			.setName('import')
			.setDescription('Import a snapshot from a file')
			.addAttachmentOption(x => x
				.setName('file')
				.setDescription('The snapshot file to import')
				.setRequired(true)
			)
		)
		.addSubcommand(x => x
			.setName('manage')
			.setDescription('Manage a snapshot (alias for list)')
		)
		// .addSubcommand(x => x
		// 	.setName('restore')
		// 	.setDescription('Restore a snapshot (alias for list)')
		// )
		.addSubcommand(x => x
			.setName('disable')
			.setDescription('Disable server snapshots')
		)
		.addSubcommand(x => x
			.setName('enable')
			.setDescription('Enable server snapshots')
		),
	execute: async function(interaction, client) {
		const savedGuild = (await GetGuild(interaction.guild!.id))!;

		const subcommand = interaction.options.getSubcommand();
		if (subcommand === 'disable' || subcommand === 'enable') {
			if (interaction.user.id !== interaction.guild!.ownerId) {
				return {
					embeds: [{
						color: COLOR.ERROR,
						title: 'Missing Permissions',
						description: 'Only the server owner can use this command'
					}],
				}
			}

			const enabled = subcommand === 'enable';
			const emoji = subcommand === 'enable' ? EMOJI.SUCCESS : EMOJI.ERROR;

			if (enabled) {
				savedGuild.features |= GUILD_FEATURES.MANAGE_SNAPSHOTS;
			} else {
				savedGuild.features &= ~GUILD_FEATURES.MANAGE_SNAPSHOTS;
			}

			void SaveGuild(savedGuild)

			return {
				embeds: [{
					color: COLOR.PRIMARY,
					description: `${emoji} Automatic snapshots have been ${enabled ? 'enabled' : 'disabled'}.`,
				}]
			}
		}

		if ( ! GetFeatureFlag(savedGuild, GUILD_FEATURES.MANAGE_SNAPSHOTS) ) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'Snapshots Disabled',
					description: 'Snapshots are disabled on this server\nPlease enable them first'
				}],
			}
		}

		if (subcommand === 'list' || subcommand === 'manage') {

			// if (isGuildRestoring(interaction.guild.id)) {
			// 	// give a warning and ask for confirmation
			// 	return interaction.editReply({
			// 		embeds: [ RestoreWarningEmbed ],
			// 		components: [{
			// 			type: 1,
			// 			components: [{
			// 				type: 2,
			// 				style: 4, // Danger button
			// 				label: 'I understand the risks',
			// 				custom_id: 'snapshot-list',
			// 				emoji: '⚠️'
			// 			}]
			// 		}]
			// 	});
			// }

			const button = client.buttons.get('snapshot-list')!;
			return button.execute(interaction as unknown as ButtonInteraction, client, []);
		}

		if (subcommand === 'create') {
			// if (isGuildRestoring(interaction.guild.id)) {
			// 	return interaction.editReply({
			// 		embeds: [ RestoreInProgressEmbed ]
			// 	});
			// }

			// @ts-expect-error
			void interaction.editReply({ embeds: [ RandomLoadingEmbed() ] });

			const snapshotID = await CreateSnapshot(interaction.guild!, SNAPSHOT_TYPE.MANUAL);

			await new Promise(resolve => setTimeout(resolve, 3000));

			const button = client.buttons.get('snapshot-manage')!;
			return button.execute(interaction as unknown as ButtonInteraction, client, [ String(snapshotID) ]); // Pass the snapshot ID to the button
		}

		if (subcommand === 'import') {
			const attachment = interaction.options.getAttachment('file');
			if (!attachment || !attachment.name.endsWith('.json')) {
				return {
					embeds: [{
						color      : COLOR.ERROR,
						title      : 'Invalid File',
						description: 'Please upload a valid snapshot file'
					}],
				}
			}

			const CorruptedEmbed = {
				color      : COLOR.ERROR,
				description: 'Unable to import snapshot - The file may be corrupted'
			}

			const response = await fetch(attachment.url);
			const fileContent = await response.text();
			let data: unknown;
			try {
				data = JSON.parse(fileContent);
			} catch (error) {
				return { embeds: [CorruptedEmbed] }
			}

			if (!data || typeof data !== 'object' || Array.isArray(data)) {
				return { embeds: [CorruptedEmbed] }
			}

			let importData: JSONSnapshot;
			try {
				importData = await BuildSnapshotFromImport(data);
			} catch (error: unknown) {
				Log('ERROR', error);
				// always true but TypeScript is a bitch lmao
				if (error instanceof Error) {
					return {
						embeds: [{
							color      : COLOR.ERROR,
							description: `
Something went wrong trying to import this snapshot! \`\`\`
${error.message}
\`\`\`
`.trim()
						}]
					}
				}
				return {};
			}

			SaveImportForGuild(interaction.guildId!, importData);

			const importSnapshot = client.buttons.get('import')!;
			return importSnapshot.execute(interaction as unknown as ButtonInteraction, client, [importData.id]);
		}

		throw new Error(`Unknown subcommand: ${subcommand}`);
	}
} satisfies CommandHandler as CommandHandler;