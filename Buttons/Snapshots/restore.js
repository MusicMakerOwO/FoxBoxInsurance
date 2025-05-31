const { COLOR, STATUS_EMOJI } = require("../../Utils/Constants");
const { FetchSnapshot, FetchAllBans, SimplifyChannel, ALLOWED_CHANNEL_TYPES, SimplifyRole, SimplifyBan, HashObject, SimplifyPermission, PermKey } = require("../../Utils/SnapshotUtils");
const { API_TYPES } = require("../../Utils/Parsers/RestoreJobs");
const { inspect } = require("node:util");

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
				modifications.channels.set(simpleChannel.id, { type: API_TYPES.CHANNEL_DELETE });
			}
		}

		for (const role of GuildRoles) {
			if (role.managed) continue; // Skip managed roles (like bot roles)
			const simpleRole = SimplifyRole(role);
			simplifiedCache.roles.set(simpleRole.id, simpleRole);
			if (!SnapshotData.roles.has(simpleRole.id)) {
				modifications.roles.set(simpleRole.id, { type: API_TYPES.ROLE_DELETE });
			}
		}
		
		for (const ban of GuildBans) {
			const simpleBan = SimplifyBan(ban);
			simplifiedCache.bans.set(simpleBan.user_id, simpleBan);
			if (!SnapshotData.bans.has(simpleBan.user_id)) {
				modifications.bans.set(simpleBan.user_id, { type: API_TYPES.BAN_DELETE });
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

		console.log( inspect(modifications, { depth: 5, colors: true }) );

		const executionEnd = Date.now();
		const executionTime = (executionEnd - executionStart) / 1000; // in seconds

		await interaction.editReply({
			embeds: [ LoadingEmbed(snapshotID, 3, [snapshotTime, currentTime, executionTime]) ],
			components: []
		});


	}
}