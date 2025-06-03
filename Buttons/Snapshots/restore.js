const { COLOR, STATUS_EMOJI, SECONDS } = require("../../Utils/Constants");
const { FetchSnapshot, FetchAllBans, SimplifyChannel, ALLOWED_CHANNEL_TYPES, SimplifyRole, SimplifyBan, HashObject, SimplifyPermission, PermKey } = require("../../Utils/SnapshotUtils");
const { API_TYPES } = require("../../Utils/Parsers/RestoreJobs");
const Log = require("../../Utils/Logs");
const SortRoles = require("../../Utils/Sort/SortRoles");
const SortChannels = require("../../Utils/Sort/SortChannels");

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

function ConvertTimeToText(seconds) {
    if (seconds < 1) return '0 seconds';
    
    const days = ~~(seconds / SECONDS.DAY);
    seconds %= SECONDS.DAY;
    const hours = ~~(seconds / SECONDS.HOUR);
    seconds %= SECONDS.HOUR;
    const minutes = ~~(seconds / SECONDS.MINUTE);
    seconds %= SECONDS.MINUTE;
    
    let output = '';
    if (days) output += `${days} day${days > 1 ? 's' : ''} `;
    if (hours) output += `${hours} hour${hours > 1 ? 's' : ''} `;
    if (minutes) output += `${minutes} minute${minutes > 1 ? 's' : ''} `;
    if (seconds) output += `${Math.floor(seconds * 1000) / 1000} second${seconds !== 1 ? 's' : ''} `;
    
    return output;
}

const NoChangesEmbed = {
	color: COLOR.SUCCESS,
	title: '🎉 No Changes Detected',
	description: 'The snapshot you are trying to restore has no changes compared to the current server state.'
}

const ownerEmbed = {
	color: COLOR.ERROR,
	title: 'Missing Permissions',
	description: 'Only the server owner can use this command'
}

const MissingMemberEmbed = {
	color: COLOR.ERROR,
	description: 'Something went wrong ... \nPlease try again later or contact support 💔'
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
			embeds: [ LoadingEmbed(snapshotID, 2, [snapshotTime, currentTime]) ],
			components: []
		});

		const executionStart = Date.now();

		const modifications = {
			channels: new Map(),
			roles: new Map(),
			bans: new Map()
		}

		const simplifiedCache = {
			channels: new Map(),
			roles: new Map(),
			bans: new Map()
		};

		// Determine deletions first
		for (const channel of GuildChannels) {
			const simpleChannel = SimplifyChannel(channel);
			simplifiedCache.channels.set(simpleChannel.id, simpleChannel);
			if (!ALLOWED_CHANNEL_TYPES.has(simpleChannel.type)) continue; // Skip unsupported channel types
			if (!SnapshotData.channels.has(simpleChannel.id)) {
				modifications.channels.set(simpleChannel.id, { type: API_TYPES.CHANNEL_DELETE, data: simpleChannel });
			}
		}

		for (const role of GuildRoles) {
			const simpleRole = SimplifyRole(role);
			simplifiedCache.roles.set(simpleRole.id, simpleRole);
			if (!SnapshotData.roles.has(simpleRole.id)) {
				modifications.roles.set(simpleRole.id, { type: API_TYPES.ROLE_DELETE, data: simpleRole });
			}
		}
		
		for (const ban of GuildBans) {
			const simpleBan = SimplifyBan(ban);
			simplifiedCache.bans.set(simpleBan.user_id, simpleBan);
			if (!SnapshotData.bans.has(simpleBan.user_id)) {
				modifications.bans.set(simpleBan.user_id, { type: API_TYPES.BAN_DELETE, data: simpleBan });
			}
		}

		// Determine creations
		for (const [id, channel] of SnapshotData.channels) {
			if (!ALLOWED_CHANNEL_TYPES.has(channel.type)) continue; // Skip unsupported channel types
			if (simplifiedCache.channels.has(id)) continue; // Channel already exists
			
			const overwrites = [];
			for (const overwrite of SnapshotData.permissions.values()) {
				const [channel_id, role_id] = overwrite.id.split('-');
				if (channel_id !== id) continue; // Only process overwrites for this channel
				overwrites.push({
					id: role_id,
					type: 0, // 0 for role overwrites
					allow: String(overwrite.allow),
					deny: String(overwrite.deny)
				});
			}
			if (overwrites.length > 0) channel.permission_overwrites = overwrites;

			modifications.channels.set(id, { type: API_TYPES.CHANNEL_CREATE, data: channel });
		}

		for (const [id, role] of SnapshotData.roles) {
			if (simplifiedCache.roles.has(id)) continue; // Role already exists
			modifications.roles.set(id, { type: API_TYPES.ROLE_CREATE, data: role });
		}

		for (const [user_id, ban] of SnapshotData.bans) {
			if (simplifiedCache.bans.has(user_id)) continue; // Ban already exists
			modifications.bans.set(user_id, { type: API_TYPES.BAN_CREATE, data: ban });
		}

		// Determine updates
		for (const channel of simplifiedCache.channels.values()) {
			const snapshotChannel = SnapshotData.channels.get(channel.id);
			if (!snapshotChannel) continue; // Channel does not exist in snapshot
			if ( HashObject(channel) === snapshotChannel.hash ) continue; // No changes detected

			modifications.channels.set(channel.id, { type: API_TYPES.CHANNEL_UPDATE, data: snapshotChannel });
		}

		for (const role of simplifiedCache.roles.values()) {
			const snapshotRole = SnapshotData.roles.get(role.id);
			if (!snapshotRole) continue; // Role does not exist in snapshot
			if ( HashObject(role) === snapshotRole.hash ) continue; // No changes detected
			modifications.roles.set(role.id, { type: API_TYPES.ROLE_UPDATE, data: snapshotRole });
		}

		for (const ban of simplifiedCache.bans.values()) {
			const snapshotBan = SnapshotData.bans.get(ban.user_id);
			if (!snapshotBan) continue; // Ban does not exist in snapshot
			if ( HashObject(ban) === snapshotBan.hash ) continue; // No changes detected
			modifications.bans.set(ban.user_id, { type: API_TYPES.BAN_UPDATE, data: snapshotBan });
		}

		for (const channel of GuildChannels) {
			if (!ALLOWED_CHANNEL_TYPES.has(channel.type)) continue; // Skip unsupported channel types
			if (!SnapshotData.channels.has(channel.id)) continue; // Channel does not exist in snapshot

			let needsPermissionUpdate = false;

			const permission_overwrites = []; // { id: string, type: 0, allow: string, deny: string }
			for (const overwrite of channel.permissionOverwrites.cache.values()) {
				if (overwrite.type !== 0) continue; // Only process role overwrites
				if (overwrite.allow.bitfield === 0n && overwrite.deny.bitfield === 0n) continue; // Skip empty overwrites

				const key = PermKey(channel.id, overwrite.id);
				const snapshotOverwrite = SnapshotData.permissions.get(key);
				if (!snapshotOverwrite) {
					// If the overwrite does not exist in the snapshot, we need to remove it
					needsPermissionUpdate = true;
					continue;
				}

				const simpleOverwrite = SimplifyPermission(channel.id, overwrite);
				if (HashObject(simpleOverwrite) === snapshotOverwrite.hash) continue; // No changes detected

				permission_overwrites.push({
					id: overwrite.id,
					type: 0, // 0 for role overwrites
					allow: String(simpleOverwrite.allow),
					deny: String(simpleOverwrite.deny)
				});

				needsPermissionUpdate = true;
			}

			if (!needsPermissionUpdate) continue;

			const channelData = modifications.channels.get(channel.id) ?? { type: API_TYPES.CHANNEL_UPDATE, data: { id: channel.id, permission_overwrites: [] } };
			if (!channelData.data.permission_overwrites) {
				channelData.data.permission_overwrites = [ ...permission_overwrites ];
			} else {
				channelData.data.permission_overwrites.push(...permission_overwrites);
			}
			modifications.channels.set(channel.id, channelData);
		}

		if ( Object.values(modifications).every(edits => edits.size === 0) ) {
			return interaction.editReply({
				embeds: [ NoChangesEmbed ],
				components: []
			});
		}

		const executionEnd = Date.now();
		const executionTime = (executionEnd - executionStart) / 1000; // in seconds

		await interaction.editReply({
			embeds: [ LoadingEmbed(snapshotID, 3, [snapshotTime, currentTime, executionTime]) ],
			components: []
		});

		const executionPlan = [
			... SortRoles( Array.from( modifications.roles.values() ), 'data' ),
			... SortChannels( Array.from( modifications.channels.values() ), 'data' ),
			... Array.from( modifications.bans.values() ) // order does not matter lol
		]

		const botMember = interaction.guild.members.cache.get(client.user.id) ?? await interaction.guild.members.fetch(client.user.id).catch(() => null);
		if (!botMember) {
			Log.error(`Failed to fetch bot member in ${interaction.guild.name} (${interaction.guild.id})`);
			return interaction.editReply({
				embeds: [ MissingMemberEmbed ],
				components: []
			});
		}

		await new Promise(resolve => setTimeout(resolve, 1000)); // simulate some delay, purely cosmetic :P

		const restoreJob = {
			snapshotID: snapshotID,
			guildID: interaction.guild.id,
			ownerID: interaction.user.id,
			botRoleID: interaction.guild.roles.cache.find(role => role.tags.botId === client.user.id).id,
			actions: executionPlan
		}

		client.timedCache.set(`restore-job-${interaction.guild.id}`, restoreJob);

		const executionStats = {
			channels: {
				created: 0,
				updated: 0,
				deleted: 0
			},
			roles: {
				created: 0,
				updated: 0,
				deleted: 0
			},
			bans: {
				created: 0,
				deleted: 0
			}
		}

		for (let i = 0; i < executionPlan.length; i++) {
			const action = executionPlan[i];
			switch (action.type) {
				case API_TYPES.CHANNEL_CREATE: executionStats.channels.created++; break;
				case API_TYPES.CHANNEL_UPDATE: executionStats.channels.updated++; break;
				case API_TYPES.CHANNEL_DELETE: executionStats.channels.deleted++; break;

				case API_TYPES.ROLE_CREATE: executionStats.roles.created++; break;
				case API_TYPES.ROLE_UPDATE: executionStats.roles.updated++; break;
				case API_TYPES.ROLE_DELETE: executionStats.roles.deleted++; break;

				case API_TYPES.BAN_CREATE: executionStats.bans.created++; break;
				case API_TYPES.BAN_DELETE: executionStats.bans.deleted++; break;

				default:
					Log.warn(`Unknown action type: ${action.type} in restore job for ${interaction.guild.name} (${interaction.guild.id})`);
					continue; // Skip unknown actions
			}
		}


		const embed = {
			color: COLOR.PRIMARY,
			description: `
**You are about to restore __snapshot #${snapshotID}__ in __${interaction.guild.name}__**
This cannot be undone and will overwrite the current server state.
Channels will be deleted, roles will be removed, and bans will be applied as per the snapshot data.

`
		}

		if (executionStats.channels.created > 0 ||
			executionStats.channels.updated > 0 ||
			executionStats.channels.deleted > 0
		) {
			embed.description += '__**💬 Channels**__'
			if (executionStats.channels.created > 0) {
				embed.description += `\n\\- **${executionStats.channels.created}** channel(s) will be created`;
			}
			if (executionStats.channels.updated > 0) {
				embed.description += `\n\\- **${executionStats.channels.updated}** channel(s) will be updated`;
			}
			if (executionStats.channels.deleted > 0) {
				embed.description += `\n\\- **${executionStats.channels.deleted}** channel(s) will be deleted`;
			}
		}

		embed.description += '\n\n';
		
		if (executionStats.roles.created > 0 ||
			executionStats.roles.updated > 0 ||
			executionStats.roles.deleted > 0
		) {
			embed.description += '__**🎭 Roles**__'
			if (executionStats.roles.created > 0) {
				embed.description += `\n\\- **${executionStats.roles.created}** role(s) will be created`;
			}
			if (executionStats.roles.updated > 0) {
				embed.description += `\n\\- **${executionStats.roles.updated}** role(s) will be updated`;
			}
			if (executionStats.roles.deleted > 0) {
				embed.description += `\n\\- **${executionStats.roles.deleted}** role(s) will be deleted`;
			}
		}
		
		embed.description += '\n\n';

		if (executionStats.bans.created > 0 ||
			executionStats.bans.deleted > 0
		) {
			embed.description += '__**🚫 Bans**__'
			if (executionStats.bans.created > 0) {
				embed.description += `\n\\- **${executionStats.bans.created}** user(s) will be banned`;
			}
			if (executionStats.bans.deleted > 0) {
				embed.description += `\n\\- **${executionStats.bans.deleted}** ban(s) will be removed`;
			}
		}

		embed.description += `\n
Are you sure you want to proceed?
This may take a while and WILL disrupt the server!
**Estimated time to complete:** \`${ConvertTimeToText( executionPlan.length * 2 )}\``

		const confirmationButtons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 4,
					label: 'Restore',
					custom_id: `restore-confirm_${snapshotID}` // one more confirmation
				},
				{
					type: 2,
					style: 3,
					label: 'Nevermind',
					custom_id: 'close'
				}
			]
		}

		interaction.editReply({
			embeds: [ embed ],
			components: [ confirmationButtons ]
		});

	}
}