import {JSONSnapshot} from "./Snapshots";
import {Guild} from "discord.js";
import {SECONDS} from "../Utils/Constants";
import {Log} from "../Utils/Log";

const IMPORT_EXPIRATION = SECONDS.HOUR * 1000;

type ExpirationEntry = Map<JSONSnapshot['id'], number>

const importCache = new Map<JSONSnapshot['id'], JSONSnapshot>();
/**
 * Tracks ownership of imports for ease cache management and expiration \
 * GuildID -> ImportID -> Expires At (unix epoch in milliseconds)
 */
const guildOwnership = new Map<Guild['id'], ExpirationEntry>();

export function SaveImportForGuild(guildID: Guild['id'], data: JSONSnapshot) {
	if (!importCache.has(data.id)) importCache.set(data.id, data);

	const ownership = guildOwnership.get(guildID) ?? new Map() as ExpirationEntry;
	ownership.set(data.id, Date.now() + IMPORT_EXPIRATION);
	guildOwnership.set(guildID, ownership);
}

export function GetImportsForGuild(guildID: Guild['id']) {
	const imports = new Map<JSONSnapshot['id'], JSONSnapshot & { expires_at: number }>();

	const ownership = guildOwnership.get(guildID) ?? new Map() as ExpirationEntry;
	if (ownership.size === 0) return imports;

	const now = Date.now();
	for (const [importID, expires_at] of ownership.entries()) {
		if (now > expires_at) {
			ownership.delete(importID);
			continue;
		}

		const data = importCache.get(importID);
		if (!data) {
			Log('ERROR', new Error('Missing import data in cache - skipping') );
			continue;
		}

		imports.set(importID, { ... data, expires_at });
	}

	return imports;
}