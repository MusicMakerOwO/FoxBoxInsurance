import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from '../../Database.js';

/**
 * §15 of the restore test plan: `DB_SETUP.sql` must stay safe to re-run against a database that
 * already has the schema applied (CI's `db-setup` step, and any admin re-running it by hand).
 * The `IF NOT EXISTS` / `IF NOT EXISTS` guards on every `CREATE TABLE` / `CREATE INDEX` make that
 * true by construction, but Bug #2's fix added a bare `UPDATE ... WHERE (features & 64) = 0` -
 * unlike the CREATE statements, an UPDATE has no "already applied" guard built into its syntax,
 * so this is the one statement in the file that could regress into ratcheting a value up on every
 * re-run if a future edit dropped the WHERE clause.
 *
 * This test assumes the schema is already applied (true both in CI, which runs `db-setup` before
 * `test`, and locally once `npm run db-setup` has been run once) and reapplies the whole file a
 * second time, statement by statement, so a failure names the exact statement that broke.
 *
 * Mirrors the parsing in `src/DatabaseSetup.ts` - that file is a top-level-await script, not a
 * module of importable functions, so the split/strip logic is duplicated here rather than shared.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

describe('DB_SETUP.sql idempotence', () => {
	it('re-applies cleanly against an already-set-up database', async () => {
		const sql = fs.readFileSync(path.join(__dirname, '../../../DB_SETUP.sql'), 'utf-8');
		const statements = parseStatements(sql);
		expect(statements.length).toBeGreaterThan(0);

		for (const statement of statements) {
			try {
				await Database.query(statement);
			} catch (error) {
				throw new Error(`Statement failed on a second apply:\n${statement}`, { cause: error });
			}
		}
	});

	it('the RESTORE_SNAPSHOTS backfill only sets bit 64 and leaves the rest of the bitmask alone', async () => {
		const id = 900_000_000_000_000_000n + BigInt(Date.now());
		// bit 1 set, bit 64 (RESTORE_SNAPSHOTS) deliberately unset, as a pre-backfill row would be
		await Database.query('INSERT INTO Guilds (id, name, features) VALUES (?, ?, ?)', [id, 'DB_SETUP idempotence test guild', 1]);
		try {
			const sql = fs.readFileSync(path.join(__dirname, '../../../DB_SETUP.sql'), 'utf-8');
			const statements = parseStatements(sql);
			const backfill = statements.find(statement => /UPDATE\s+Guilds\s+SET\s+features/i.test(statement));
			expect(backfill).toBeDefined();

			for (const statement of statements) await Database.query(statement);

			const rows = await Database.query('SELECT features FROM Guilds WHERE id = ?', [id]);
			expect(Number(rows[0].features)).toBe(1 | 64);

			// running it again must not double-toggle or error - the WHERE guard means the row no
			// longer matches, so the second pass leaves it untouched
			for (const statement of statements) await Database.query(statement);
			const rowsAgain = await Database.query('SELECT features FROM Guilds WHERE id = ?', [id]);
			expect(Number(rowsAgain[0].features)).toBe(1 | 64);
		} finally {
			await Database.query('DELETE FROM Guilds WHERE id = ?', [id]);
		}
	});
});
