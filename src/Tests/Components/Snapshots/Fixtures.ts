import { vi } from 'vitest';
import { SNAPSHOT_TYPE } from '../../../Utils/Constants.js';
import { JSONSnapshot, Snapshot } from '../../../CRUD/Snapshots.js';
import { SnapshotMetadata } from '../../../Typings/DatabaseTypes.js';
import { MockInteraction, makeInteraction } from '../Helpers.js';

/**
 * Shared fixtures for the snapshot management suites - no tests of its own.
 *
 * The two snapshot CRUD modules are replaced by an in-memory store. Each test file wires them in with
 * ```ts
 * vi.mock('../../../CRUD/Snapshots.js', async (importOriginal) => ({ ...await importOriginal<object>(), ...(await import('./Fixtures.js')).SnapshotsMock }));
 * vi.mock('../../../CRUD/SnapshotImports.js', async () => (await import('./Fixtures.js')).ImportsMock);
 * ```
 * (`vi.mock` has to live in the test file to be hoisted). The fakes keep the real functions' checks
 * that handlers depend on - DeleteSnapshot refusing pinned or unknown ids, SetSnapshotPinStatus
 * refusing when the slots are full - so a race between a prompt and its confirm can be staged by
 * editing the store in between.
 */

export const GUILD_ID       = '900000000000000006';
export const OTHER_GUILD_ID = '900000000000000016';
export const USER_ID        = '900000000000000005';
export const OWNER_ID       = '900000000000000007';

/** An import id that starts with digits - `parseInt` reads it as stored snapshot #2345 */
export const IMPORT_ID = '2345-ABCD-EFGH-JKLM';

export const MAX_SNAPSHOTS = 7;

type Counts = { channels?: number, roles?: number, bans?: number };

type ImportChannel = JSONSnapshot['channels'][number];
type ImportRole = JSONSnapshot['roles'][number];
type ImportBan = JSONSnapshot['bans'][number];
type StoredImport = JSONSnapshot & { expires_at: number };

export const store = {
	snapshots: new Map<number, Snapshot>(),
	/** Guild id -> import id -> import, as listed by `import-confirm` */
	imports  : new Map<string, Map<string, StoredImport>>(),
	/** Guild id -> import id -> import, uploaded but still behind the warning prompt */
	staged   : new Map<string, Map<string, StoredImport>>(),
	/** Ids `IsSnapshotQueuedForDeletion` flags */
	queued   : new Set<number>()
};

export function ResetStore(): void {
	store.snapshots.clear();
	store.imports.clear();
	store.staged.clear();
	store.queued.clear();
}

/** Keyed 1..n like the real Maps; `option` is a count or the exact entries (merged over the defaults) */
function Entries<T extends object>(option: number | Partial<T>[] | undefined, fallback: number, make: (i: number) => T): Map<bigint, T> {
	const entries = Array.isArray(option)
		? option.map((entry, i) => ({ ...make(i), ...entry }))
		: Array.from({ length: option ?? fallback }, (_, i) => make(i));
	return new Map(entries.map((entry, i) => [ BigInt(i + 1), entry ]));
}

export type StoredOptions = Omit<Counts, 'channels' | 'roles' | 'bans'> & {
	channels?: EntriesOption<object>;
	roles?   : EntriesOption<object>;
	bans?    : EntriesOption<object>;
	guild_id?  : bigint;
	pinned?    : boolean;
	type?      : SnapshotMetadata['type'];
	created_at?: Date;
};

/** Adds a stored snapshot to the store, shaped exactly as `GetSnapshot` returns it */
export function storedSnapshot(id: number, options: StoredOptions = {}): Snapshot {
	const snapshot = {
		id,
		guild_id  : options.guild_id ?? BigInt(GUILD_ID),
		type      : options.type ?? SNAPSHOT_TYPE.MANUAL,
		pinned    : options.pinned ? 1 : 0,
		created_at: options.created_at ?? new Date(1_700_000_000_000 + id * 86_400_000),
		channels  : Entries(options.channels, 3, i => ({ id: BigInt(i + 1), name: `channel-${i}` })),
		roles     : Entries(options.roles, 2, i => ({ id: BigInt(i + 1), name: `role-${i}`, managed_by: null })),
		bans      : Entries(options.bans, 1, i => ({ id: BigInt(i + 1), reason: null }))
	} as unknown as Snapshot;
	store.snapshots.set(id, snapshot);
	return snapshot;
}

/** A count, or the exact entries to use */
type EntriesOption<T> = number | Partial<T>[];

function ImportEntries<T>(option: EntriesOption<T> | undefined, fallback: number, make: (i: number) => T): T[] {
	if (Array.isArray(option)) return option.map((entry, i) => ({ ...make(i), ...entry }));
	return Array.from({ length: option ?? fallback }, (_, i) => make(i));
}

export type ImportOptions = {
	channels?  : EntriesOption<ImportChannel>;
	roles?     : EntriesOption<ImportRole>;
	bans?      : EntriesOption<ImportBan>;
	guildID?   : string;
	expires_at?: number;
	/** Uploaded but not yet confirmed - only the import screens can see it */
	staged?    : boolean;
};

/** Lists an import for a guild, as `SaveImportForGuild` would - or stages it, as `/snapshot import` does */
export function importSnapshot(id: string = IMPORT_ID, options: ImportOptions = {}): StoredImport {
	const guildID = options.guildID ?? GUILD_ID;
	const data = {
		id,
		version   : 2,
		type      : SNAPSHOT_TYPE.IMPORT,
		channels  : ImportEntries(options.channels, 4, i => ({ id: BigInt(i + 1), name: `channel-${i}` }) as unknown as ImportChannel),
		roles     : ImportEntries(options.roles, 5, i => ({ id: BigInt(i + 1), name: `role-${i}`, managed_by: null }) as unknown as ImportRole),
		bans      : ImportEntries(options.bans, 6, i => ({ id: BigInt(i + 1), reason: null }) as unknown as ImportBan),
		expires_at: options.expires_at ?? Date.now() + 30 * 60 * 1000
	} as unknown as StoredImport;
	const owners = options.staged ? store.staged : store.imports;
	const imports = owners.get(guildID) ?? new Map();
	imports.set(id, data);
	owners.set(guildID, imports);
	return data;
}

function GuildSnapshots(guildID: bigint): Snapshot[] {
	return [ ...store.snapshots.values() ]
		.filter(snapshot => snapshot.guild_id === guildID)
		.sort((a, b) => a.id - b.id);
}

export const SnapshotsMock = {
	GetSnapshot: vi.fn(async (id: number) => store.snapshots.get(id) ?? null),
	ListSnapshotsForGuild: vi.fn(async (guildID: string | bigint) => GuildSnapshots(BigInt(guildID))),
	MaxSnapshotsForGuild: vi.fn(async () => MAX_SNAPSHOTS),
	IsSnapshotQueuedForDeletion: vi.fn(async (id: number) => store.queued.has(id)),
	IsSnapshotDeletable: vi.fn(async (id: number) => {
		const snapshot = store.snapshots.get(id);
		return !!snapshot && !snapshot.pinned;
	}),
	DeleteSnapshot: vi.fn(async (id: number) => {
		const snapshot = store.snapshots.get(id);
		if (!snapshot) throw new Error('Snapshot not found');
		if (snapshot.pinned) throw new Error('Cannot delete a pinned snapshot');
		store.snapshots.delete(id);
	}),
	SetSnapshotPinStatus: vi.fn(async (id: number, pinned: boolean) => {
		const snapshot = store.snapshots.get(id);
		if (!snapshot) throw new Error('Snapshot not found');
		const pinCount = GuildSnapshots(snapshot.guild_id).filter(s => s.pinned).length;
		if (pinned && pinCount >= MAX_SNAPSHOTS) throw new Error('Cannot pin snapshot - Slots are already full');
		snapshot.pinned = pinned ? 1 : 0;
	}),
	ExportSnapshot: vi.fn()
};

function Unexpired(owners: Map<string, Map<string, StoredImport>>, guildID: string): Map<string, StoredImport> {
	const now = Date.now();
	return new Map([ ...(owners.get(guildID) ?? new Map<string, StoredImport>()) ]
		.filter(([ , data ]) => data.expires_at > now));
}

export const IMPORT_EXPIRATION = 60 * 60 * 1000;

/** The real module is covered on its own in Imports/ImportStaging.test.ts */
export const ImportsMock = {
	IMPORT_EXPIRATION,
	GetImportsForGuild: vi.fn((guildID: string) => Unexpired(store.imports, guildID)),
	GetStagedImport: vi.fn((guildID: string, id: string) => Unexpired(store.staged, guildID).get(id) ?? null),
	StageImportForGuild: vi.fn((guildID: string, data: JSONSnapshot) => {
		const staged = store.staged.get(guildID) ?? new Map();
		staged.set(data.id, { ...data, expires_at: Date.now() + IMPORT_EXPIRATION });
		store.staged.set(guildID, staged);
	}),
	DiscardStagedImport: vi.fn((guildID: string, id: string) => {
		store.staged.get(guildID)?.delete(id);
	}),
	SaveImportForGuild: vi.fn((guildID: string, data: StoredImport) => {
		store.staged.get(guildID)?.delete(data.id);
		const listed = { ...data, expires_at: Date.now() + IMPORT_EXPIRATION };
		const imports = store.imports.get(guildID) ?? new Map();
		imports.set(data.id, listed);
		store.imports.set(guildID, imports);
		return listed.expires_at;
	})
};

/** An Administrator in GUILD_ID who is not the owner */
export function interaction(options: Parameters<typeof makeInteraction>[0] = {}): MockInteraction {
	return makeInteraction({ guildId: GUILD_ID, userId: USER_ID, ownerId: OWNER_ID, memberPerms: [], ...options });
}
