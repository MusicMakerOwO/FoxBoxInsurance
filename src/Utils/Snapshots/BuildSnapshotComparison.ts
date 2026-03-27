import { Guild } from "discord.js";
import { SnapshotComparable } from "./GuildDiff";
import { FetchAllBans } from "./FetchAllBans";
import { SimplifyBan, SimplifyChannel, SimplifyRole } from "./SimplifyGuildData";
import { Snapshot } from "../../CRUD/Snapshots";

export async function BuildSnapshotComparison(data: Guild | Snapshot | null): Promise<SnapshotComparable> {
	const comparison: SnapshotComparable = {
		roles: new Map(),
		channels: new Map(),
		bans: new Map()
	}
	if (!data) return comparison;

	const channels = 'cache' in data.channels ? data.channels.cache : data.channels;
	const roles        = 'cache' in data.roles ? data.roles.cache : data.roles
	const bans     = data instanceof Guild ? await FetchAllBans(data).catch( () => new Map() ) : data.bans;

	for (const channel of channels.values()) {
		comparison.channels.set( BigInt(channel.id), SimplifyChannel(channel) );
	}

	for (const role of roles.values()) {
		comparison.roles.set( BigInt(role.id), SimplifyRole(role) );
	}

	for (const ban of bans.values()) {
		comparison.bans.set( 'user' in ban ? BigInt(ban.user.id) : ban.id, SimplifyBan(ban) );
	}

	return comparison;
}