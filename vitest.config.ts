// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { existsSync } from 'node:fs'

// CI sets env vars (e.g. PEPPER) directly and has no .env file; local dev keeps them in .env.
if (existsSync('.env')) process.loadEnvFile('.env');

// Tests run on the same UTC process clock the bot runs on, so anything asserting on a formatted or
// decoded timestamp matches production rather than the developer's local zone. The database itself
// is always mocked here. See src/Utils/ProcessTimezone.ts.
process.env.TZ = 'UTC';

export default defineConfig({
	test: {
		include: ['./src/Tests/**/*.test.ts'],
		fileParallelism: true
	}
})