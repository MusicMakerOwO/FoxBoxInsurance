import {JSONSnapshot} from "./Snapshots.js";
import {Guild} from "discord.js";
import {SECONDS} from "../Utils/Constants.js";
import {Log} from "../Utils/Log.js";

/** How long an import stays listed after it's confirmed - and how long it can sit staged before that */
export const IMPORT_EXPIRATION = SECONDS.HOUR * 1000;

type ExpirationEntry = Map<JSONSnapshot['id'], number>

const importCache = new Map<JSONSnapshot['id'], JSONSnapshot>();
/**
 * Tracks ownership of imports for ease cache management and expiration \
 * GuildID -> ImportID -> Expires At (unix epoch in milliseconds)
 *
 * `listedOwnership` is what the guild sees in `/snapshot list` and can restore from. \
 * `stagedOwnership` is an upload still waiting on the "can contain harmful data" warning - it is only
 * reachable from the import screens until `import-confirm` lists it.
 */
const listedOwnership = new Map<Guild['id'], ExpirationEntry>();
const stagedOwnership = new Map<Guild['id'], ExpirationEntry>();

function IsImportOwnedByAnyGuild(importID: JSONSnapshot['id']): boolean {
	for (const owners of [ listedOwnership, stagedOwnership ]) {
		for (const ownership of owners.values()) {
			if (ownership.has(importID)) return true;
		}
	}
	return false;
}

function Release(ownership: ExpirationEntry, importID: JSONSnapshot['id']): void {
	ownership.delete(importID);
	if (!IsImportOwnedByAnyGuild(importID)) importCache.delete(importID);
}

/** Every unexpired import in `ownership`, pruning the expired ones as it goes */
function Collect(ownership: ExpirationEntry | undefined): Map<JSONSnapshot['id'], JSONSnapshot & { expires_at: number }> {
	const imports = new Map<JSONSnapshot['id'], JSONSnapshot & { expires_at: number }>();
	if (!ownership || ownership.size === 0) return imports;

	const now = Date.now();
	for (const [importID, expires_at] of ownership.entries()) {
		if (now > expires_at) {
			Release(ownership, importID);
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

function Own(owners: Map<Guild['id'], ExpirationEntry>, guildID: Guild['id'], importID: JSONSnapshot['id']): number {
	const expires_at = Date.now() + IMPORT_EXPIRATION;
	const ownership = owners.get(guildID) ?? new Map() as ExpirationEntry;
	ownership.set(importID, expires_at);
	owners.set(guildID, ownership);
	return expires_at;
}

/** Holds a freshly uploaded import for `guildID` without listing it - see `SaveImportForGuild` */
export function StageImportForGuild(guildID: Guild['id'], data: JSONSnapshot): void {
	// Overwrite: a re-upload of the same export must not keep serving whatever was cached first
	importCache.set(data.id, data);
	Own(stagedOwnership, guildID, data.id);
}

export function GetStagedImport(guildID: Guild['id'], importID: JSONSnapshot['id']): (JSONSnapshot & { expires_at: number }) | null {
	return Collect(stagedOwnership.get(guildID)).get(importID) ?? null;
}

/** Drops a staged import - a listed import with the same id is left alone */
export function DiscardStagedImport(guildID: Guild['id'], importID: JSONSnapshot['id']): void {
	const ownership = stagedOwnership.get(guildID);
	if (ownership) Release(ownership, importID);
}

/**
 * Lists an import for `guildID` for the next `IMPORT_EXPIRATION`, dropping it from staging. Listing an
 * already-listed import restarts its clock. Returns the new expiry (unix epoch in milliseconds).
 */
export function SaveImportForGuild(guildID: Guild['id'], data: JSONSnapshot): number {
	// Callers pass what GetStagedImport / GetImportsForGuild returned - the cached copy plus expires_at
	if (!importCache.has(data.id)) importCache.set(data.id, data);
	const expires_at = Own(listedOwnership, guildID, data.id);
	stagedOwnership.get(guildID)?.delete(data.id);
	return expires_at;
}

/** The imports listed for `guildID` - staged imports are not included */
export function GetImportsForGuild(guildID: Guild['id']): Map<JSONSnapshot['id'], JSONSnapshot & { expires_at: number }> {
	return Collect(listedOwnership.get(guildID));
}
