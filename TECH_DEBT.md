## High — correctness/safety risk

- [x] **No linter or formatter at all** — no `.eslintrc`/`eslint.config.*`, no `prettier` config, no `lint` script in `package.json`. Style is only self-consistent because one person wrote it. Everything downstream (dead code, unused imports, `any` creep) compounds without one.
  - Done: `eslint.config.ts` added (flat config, `typescript-eslint` + `eslint-plugin-unicorn`), `npm run check`/`build` now run `eslint .` before `tsgo`.

- [ ] **Tests hit a real MariaDB instance and aren't parallel-safe** (`fileParallelism: false` in `vitest.config.ts`; 8 test files import `Database` directly). Slow, order-dependent, hard to run offline/in isolation — a bad instance state cascades failures across unrelated tests. Decide deliberately between "these are integration tests, keep the real DB but isolate with transactions/rollback per test" vs "mock the DB boundary and keep integration tests as a separate, explicitly-tagged suite."
  - Not yet — `vitest.config.ts` still has `fileParallelism: false`, unchanged. This was the planned test overhaul, not part of the linter pass.

- [ ] **`void` fire-and-forget everywhere with no rejection handling** (32 top-level `void` calls). Several are DB writes or cache-sensitive operations — e.g. `Utils/Tasks/AutomaticTasks.ts`'s task runner calls `callback()` without `await`/`.catch`, so a rejected task promise becomes an unhandled rejection routed only through the global `process.on('unhandledRejection', ...)` logger. No per-task retry, alerting, or clarity on which task failed.
  - Not fixed — the new `@typescript-eslint/no-floating-promises: error` rule now forces every promise to be explicitly `await`ed or `void`ed (count actually went up, 32 → 37, from call sites that were silently floating before), but `AutomaticTasks.ts` still does `void callback()` inside a `try/catch` — that `catch` only ever catches a *synchronous* throw, not the rejection from the fire-and-forget promise, so a failing task is still silently lost. Genuinely needs `.catch()` on the callback itself, not just lint compliance.

- [x] **`@ts-ignore` clusters, especially in `Events/Handlers/GlobalHandler.ts`** (6 of 9 total in the codebase) around private discord.js properties (`interaction.options._subcommand`, etc.) and an interaction-type switch. Fragile across discord.js version bumps — a linter won't catch that breaking silently. Worth noting which discord.js version this was verified against, or isolating the private-property reads into one small typed helper so a breakage has one place to look.
  - Done (partially): all converted `@ts-ignore` → `@ts-expect-error` with a reason comment on each. This is a real improvement — `@ts-expect-error` itself errors if the suppression ever becomes unnecessary, so a discord.js upgrade that fixes the underlying type will now be caught by `tsgo`. The private-property reads are still inline rather than isolated into a helper, so that suggestion is still open if you want it.

## Medium — maintainability/DX

- [x] **No CI type-check/lint gate beyond build+test.** `.github/workflows/node.js.yml` runs build → db-setup → test, so type errors are already caught (build fails), but nothing stops a PR introducing `any`, unused exports, or inconsistent formatting. Once a linter is added, wire it into CI immediately, not just locally.
  - Done: `npm run build` (which CI already runs) now runs `eslint .` first, so lint failures fail the CI build step. No separate `lint` job needed.

- [ ] **Inconsistent error-handling granularity.** Some paths throw custom error codes (`SNAPSHOT_ERRORS` in imports), others just `Log('ERROR', err)` and swallow, others let it bubble to `uncaughtException`/`unhandledRejection`. No single documented convention for "when do we throw vs. log vs. return an error embed."

- [ ] **`AGENTS.md` is stale** — references a `check:go` script that doesn't exist. Either fix or delete it; agent-facing docs that lie are worse than none.

- [ ] **Magic numbers for Discord interaction/component types** — `GlobalHandler.ts` uses raw `2`/`3`/`4`/`5` for interaction types instead of discord.js's enum, with a comment noting it's a TS7 workaround. If that's genuinely required, isolate it behind one named constant so it doesn't spread.

## Low — polish

- [ ] **No `engines` field in `package.json`** — CI pins Node 22, but a contributor running a different major could hit subtle `tsgo`/native module (`canvas`) build failures with no upfront signal.

- [ ] **Test fixtures are large inline object literals repeated per test file** (`API_USER`, `API_ATTACHMENT`, etc. in `Tests/SaveMessages.test.ts`) rather than shared factories. Not a bug, just duplication — likely to get fixed organically during the test overhaul, calling it out so it isn't missed.