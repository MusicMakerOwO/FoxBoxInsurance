import { defineConfig } from "eslint/config";
import { Plugin } from "@eslint/core";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";

const localRules: Plugin = {
	rules: {
		"require-unref-on-timers": {
			meta: {
				type: "problem",
				docs: {
					description: "Require .unref() on setTimeout/setInterval calls",
				},
				schema: [],
				messages: {
					missingUnref:
						"{{name}} should be followed by .unref() to avoid keeping the process alive",
				},
			},
			create(context) {
				return {
					CallExpression(node) {
						if (node.callee.type !== "Identifier") {
							return;
						}

						const { name } = node.callee;
						if (name !== "setInterval" && name !== "setTimeout") {
							return;
						}

						const parent = node.parent;
						const isUnrefChain =
							parent?.type === "MemberExpression" &&
							parent.object === node &&
							!parent.computed &&
							parent.property.type === "Identifier" &&
							parent.property.name === "unref" &&
							parent.parent?.type === "CallExpression" &&
							parent.parent.callee === parent;

						if (!isUnrefChain) {
							context.report({
								node,
								messageId: "missingUnref",
								data: { name }
							});
						}
					}
				};
			}
		}
	}
} as const;

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
			local: localRules,
			unicorn,
		},
		rules: {
			"@typescript-eslint/no-unused-vars": "warn",

			// Catch promises that aren't awaited or handled
			"@typescript-eslint/no-floating-promises": "error",

			// Prevent accidental `any` at function boundaries
			"@typescript-eslint/explicit-module-boundary-types": "warn",

			// Unicorn rules worth having
			"unicorn/no-for-each": "error", // use for..of instead
			"unicorn/prefer-node-protocol": "error", // import 'node:fs' not 'fs'
			"unicorn/no-process-exit": "error", // use proper shutdown

			// Warn when timers are not directly chained with .unref()
			"local/require-unref-on-timers": "error",
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