// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { existsSync } from 'node:fs'

// CI sets env vars (e.g. PEPPER) directly and has no .env file; local dev keeps them in .env.
if (existsSync('.env')) process.loadEnvFile('.env');

// Tests hit a real MariaDB; they need the same UTC process clock the bot runs on so DATETIME
// columns decode to the instant they were written. See src/Utils/ProcessTimezone.ts.
process.env.TZ = 'UTC';

export default defineConfig({
	test: {
		include: ['./src/Tests/**/*.test.ts'],
		fileParallelism: true
	}
})