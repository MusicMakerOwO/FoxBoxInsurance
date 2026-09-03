import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * §14/§15 of the restore test plan, as static assertions over `DB_SETUP.sql` rather than by
 * applying it - `npm test` has no database (CI runs `build` -> `test`, with no MariaDB service),
 * so the guarantees are pinned against the file's text instead of MariaDB's behavior.
 *
 * Two things are being protected here, both of which a future migration could break silently:
 *
 * 1. Re-running the file must stay safe. The `IF NOT EXISTS` guards make that true by construction
 *    for every CREATE, but Bug #2's fix added a bare `UPDATE Guilds SET features = ...` - an UPDATE
 *    has no "already applied" guard in its syntax, so it is the one statement that could regress
 *    into ratcheting a value on every re-run if an edit dropped its WHERE clause.
 *
 * 2. `SnapshotRestores` must *not* gain a foreign key on `snapshot_id`/`safety_snapshot_id`. A
 *    retry replays the payloads persisted on `SnapshotRestoreActions`, which only works for as long
 *    as deleting the source snapshot leaves those rows alone. Adding the "missing" foreign key would
 *    break retry with no visible failure anywhere else.
 *
 * Mirrors the parsing in `src/DatabaseSetup.ts` - that file is a top-level-await script, not a
 * module of importable functions, so the split/strip logic is duplicated here rather than shared.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL = fs.readFileSync(path.join(__dirname, '../../../DB_SETUP.sql'), 'utf-8');

function parseStatements(sql: string): string[] {
	return sql
		.split('\n')
		.map(line => line.replace(/--.*$/, '').trim())
		.filter(line => !line.startsWith('#'))
		.join('\n')
		.split(';')
		.map(s => s.trim())
		.filter(s => s.length > 0);
}

const STATEMENTS = parseStatements(SQL);

/** The body of a `CREATE TABLE`, comments already stripped by `parseStatements` */
function tableDefinition(name: string): string {
	const statement = STATEMENTS.find(s => new RegExp(`^CREATE TABLE (IF NOT EXISTS )?${name}\\s*\\(`, 'i').test(s));
	if (!statement) throw new Error(`No CREATE TABLE statement for ${name} in DB_SETUP.sql`);
	return statement;
}

describe('DB_SETUP.sql parsing', () => {
	// Everything below filters this list, so a parse that silently produced nothing would make the
	// whole file pass vacuously
	it('yields statements', () => {
		expect(STATEMENTS.length).toBeGreaterThan(0);
	});

	it('leaves no comment markers in the parsed statements', () => {
		expect(STATEMENTS.filter(s => s.includes('--'))).toEqual([]);
	});
});

describe('DB_SETUP.sql idempotence', () => {
	it('guards every CREATE TABLE with IF NOT EXISTS', () => {
		const creates = STATEMENTS.filter(s => /^CREATE TABLE/i.test(s));
		expect(creates.length).toBeGreaterThan(0);

		const unguarded = creates.filter(s => !/^CREATE TABLE IF NOT EXISTS/i.test(s));
		expect(unguarded).toEqual([]);
	});

	it('guards every CREATE INDEX with IF NOT EXISTS', () => {
		const indexes = STATEMENTS.filter(s => /^CREATE INDEX/i.test(s));
		expect(indexes.length).toBeGreaterThan(0);

		const unguarded = indexes.filter(s => !/^CREATE INDEX IF NOT EXISTS/i.test(s));
		expect(unguarded).toEqual([]);
	});

	it('keeps the WHERE guard on the RESTORE_SNAPSHOTS backfill', () => {
		const backfill = STATEMENTS.find(s => /^UPDATE\s+Guilds\s+SET\s+features/i.test(s));
		expect(backfill).toBeDefined();

		// `|` is idempotent on its own, but the WHERE is what keeps a re-run from touching rows at
		// all - both together are the reason this statement is safe to ship in a setup script
		expect(backfill).toMatch(/features\s*\|\s*64/i);
		expect(backfill).toMatch(/WHERE\s*\(\s*features\s*&\s*64\s*\)\s*=\s*0/i);
	});

	/**
	 * The only statement in the file that is not a CREATE. If a second one ever appears it needs
	 * the same scrutiny as the backfill above, so fail here rather than let it through unexamined.
	 */
	it('has no other non-CREATE statements', () => {
		const others = STATEMENTS.filter(s => !/^CREATE (TABLE|INDEX)/i.test(s) && !/^UPDATE\s+Guilds\s+SET\s+features/i.test(s));
		expect(others).toEqual([]);
	});
});

describe('SnapshotRestores foreign keys', () => {
	it('cascades from Guilds, so deleting a guild takes its runs with it', () => {
		expect(tableDefinition('SnapshotRestores')).toMatch(/FOREIGN KEY\s*\(\s*guild_id\s*\)\s*REFERENCES\s+Guilds\s*\(\s*id\s*\)\s*ON DELETE CASCADE/i);
	});

	it('cascades its actions from the run', () => {
		expect(tableDefinition('SnapshotRestoreActions')).toMatch(/FOREIGN KEY\s*\(\s*restore_id\s*\)\s*REFERENCES\s+SnapshotRestores\s*\(\s*id\s*\)\s*ON DELETE CASCADE/i);
	});

	/**
	 * The guarantee behind `RetryRestore`: the run and its persisted payloads outlive the snapshot
	 * they were built from. `safety_snapshot_id` is FK-less for a related but distinct reason - the
	 * safety snapshot may be unpinned and rotated away long after the run finished.
	 */
	it('has no foreign key on snapshot_id or safety_snapshot_id', () => {
		const definition = tableDefinition('SnapshotRestores');
		const foreignKeys = definition.match(/FOREIGN KEY[^,\n]*/gi) ?? [];

		expect(foreignKeys).toHaveLength(1);
		expect(foreignKeys[0]).not.toMatch(/snapshot_id/i);
	});
});

/**
 * The contrast that makes the rule above meaningful: a snapshot's own entity rows *do* go away with
 * it. If these ever stopped cascading, the "restores are the exception" reasoning would be wrong.
 */
describe('snapshot entity tables cascade from Snapshots', () => {
	for (const table of ['SnapshotRoles', 'SnapshotChannels', 'SnapshotBans']) {
		it(`${table} cascades from Snapshots(id)`, () => {
			expect(tableDefinition(table)).toMatch(/FOREIGN KEY\s*\(\s*snapshot_id\s*\)\s*REFERENCES\s+Snapshots\s*\(\s*id\s*\)\s*ON DELETE CASCADE/i);
		});
	}
});
