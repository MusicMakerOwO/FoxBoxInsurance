import { defineConfig } from "eslint/config";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";

export default defineConfig(
	// Ignore files not in the TypeScript project
	{
		ignores: ["scripts/**", "dist/**", "build/**", "node_modules/**", "examples/**", "vitest.config.ts", "eslint.config.ts", "tsup.config.ts", "UploadCache/**"],
	},

	// Base JS recommended rules
	eslint.configs.recommended,

	// TypeScript-aware rules
	...tseslint.configs.recommended,

	// Your custom config
	{
		plugins: {
			unicorn,
		},
		rules: {
			"@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],

			// Catch promises that aren't awaited or handled
			"@typescript-eslint/no-floating-promises": "error",

			// Prevent accidental `any` at function boundaries
			"@typescript-eslint/explicit-module-boundary-types": "warn",

			// Unicorn rules worth having
			"unicorn/no-for-each": "error", // use for..of instead
			"unicorn/prefer-node-protocol": "error", // import 'node:fs' not 'fs'
			"unicorn/no-process-exit": "error", // use proper shutdown
		},
	},

	// Tell TS-ESLint where your tsconfig is (needed for type-aware rules)
	{
		languageOptions: {
			parserOptions: {
				project: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
);