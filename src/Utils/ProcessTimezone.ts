/**
 * Pins this process to UTC, so that the clock JavaScript calls "local" is the same clock the
 * database stores.
 *
 * MariaDB hands DATETIME columns back over the wire as strings like `2026-09-02 19:10:36`, and
 * the connector decodes them with `new Date(string)` - which V8 reads as *local* time, not UTC.
 * Date parameters go out the same way (the connector's writer builds them out of `getHours()`
 * and friends), so a process that is not on UTC skews every DATETIME in both directions by its
 * local offset: `Snapshots.created_at` written at 19:10 UTC reads back as 00:10 the next day on
 * a UTC-5 machine, five hours in the future.
 *
 * The connector has no option to decode as UTC - matching the two clocks is the only arrangement
 * where its conversions are lossless. `Database.ts` pins the session end (`timezone=Z`) to match.
 *
 * Side effect: `Utils/Log.ts` timestamps are UTC as well, since they are built from local getters.
 *
 * Imported for the side effect, and it has to be the *first* import in `index.ts`: ESM evaluates
 * every import before the importing module's own body runs, so an assignment written directly in
 * `index.ts` would land after all the other modules had already been initialized.
 */
process.env.TZ = 'UTC';