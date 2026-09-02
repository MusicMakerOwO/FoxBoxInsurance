import { Guild } from "discord.js";
import { SnapshotComparable } from "./GuildDiff.js";
import { FetchAllBans } from "./FetchAllBans.js";
import { SimplifyBan, SimplifyChannel, SimplifyRole } from "./SimplifyGuildData.js";
import { Snapshot, JSONSnapshot } from "../../CRUD/Snapshots.js";

export async function BuildSnapshotComparison(data: Guild | Snapshot | JSONSnapshot | null): Promise<SnapshotComparable> {
	const comparison: SnapshotComparable = {
		roles: new Map(),
		channels: new Map(),
		bans: new Map()
	}
	if (!data) return comparison;

	// JSONSnapshot (imports) stores these as plain arrays rather than a live GuildChannelManager
	// or a stored Snapshot's Maps - branch explicitly instead of relying on Array.prototype.values()
	// incidentally matching the Map/Collection shape.
	const channels = Array.isArray(data.channels) ? data.channels : ('cache' in data.channels ? data.channels.cache : data.channels );
	const roles    = Array.isArray(data.roles)    ? data.roles    : ('cache' in data.roles    ? data.roles   .cache : data.roles    );
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