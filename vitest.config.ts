// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['./src/Tests/**/*.ts'],
		fileParallelism: false
	}
})