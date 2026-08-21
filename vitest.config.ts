// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { existsSync } from 'node:fs'

// CI sets env vars (e.g. PEPPER) directly and has no .env file; local dev keeps them in .env.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
	test: {
		include: ['./src/Tests/**/*.ts'],
		fileParallelism: true
	}
})