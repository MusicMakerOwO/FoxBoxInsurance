import { Guild } from "discord.js";
import { GetImportsForGuild, GetStagedImport } from "../CRUD/SnapshotImports.js";
import { GetSnapshot, JSONSnapshot, Snapshot } from "../CRUD/Snapshots.js";

export type GuildSnapshot = (JSONSnapshot & { expires_at: number }) | Snapshot;

/**
 * A stored snapshot id as it appears in a custom_id - canonical digits only, so `parseInt` can't read
 * an import id like `2345-ABCD-EFGH-JKLM` as stored snapshot #2345.
 */
export function ParseStoredSnapshotID(id: string | undefined): number | null {
	if (id === undefined || !/^[1-9]\d*$/.test(id)) return null;
	const snapshotID = Number(id);
	return Number.isSafeInteger(snapshotID) ? snapshotID : null;
}

/**
 * The snapshot `id` refers to, as seen from `guildID` - one of its imports, otherwise one of its stored
 * snapshots. Stored snapshots are looked up by id alone, so anything owned by another guild is null.
 */
export async function GetGuildSnapshot(guildID: Guild['id'], id: string): Promise<GuildSnapshot | null> {
	const imported = GetImportsForGuild(guildID).get(id);
	if (imported) return imported;

	const snapshotID = ParseStoredSnapshotID(id);
	if (snapshotID === null) return null;

	const snapshot = await GetSnapshot(snapshotID);
	if (!snapshot || snapshot.guild_id !== BigInt(guildID)) return null;
	return snapshot;
}


export type GuildImport = { data: JSONSnapshot & { expires_at: number }, staged: boolean };

/**
 * One of `guildID`'s imports for the import screens - the staged upload still behind the warning
 * prompt first, otherwise the listed one. `staged` tells those screens which flow they are in: Back
 * returns to the prompt (`import_<id>`) while staged, and to `snapshot-manage_<id>` once listed.
 */
export function FindImport(guildID: Guild['id'], id: string | undefined): GuildImport | null {
	if (id === undefined) return null;

	const staged = GetStagedImport(guildID, id);
	if (staged) return { data: staged, staged: true };

	const listed = GetImportsForGuild(guildID).get(id);
	return listed ? { data: listed, staged: false } : null;
}
