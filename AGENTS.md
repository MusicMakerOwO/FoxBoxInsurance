# AGENTS.md

## Project Overview
Fox Box Insurance (FBI) is a TypeScript/Node.js Discord bot focused on data ownership, transparency, and user empowerment. It provides advanced backup, export, and recovery features for Discord servers, prioritizing post-chaos recovery over traditional moderation. The codebase is modular, with clear separation of concerns and a focus on extensibility.

## Architecture & Key Components
- **src/CRUD/**: Core data operations for users, channels, guilds, snapshots, etc. Snapshots are a central concept, enabling full server state capture and restoration.
- **src/Services/**: Higher-level logic that combines CRUD operations (e.g., TOS checks, user encryption key management).
- **src/Commands/**: Entry points for all bot commands. Each command is a separate file or folder.
- **src/Buttons, Menus, Modals/**: UI interaction handlers for Discord components.
- **src/Utils/**: Shared utilities, constants, logging, and data structures. Includes snapshot parsing, validation, and import/export logic.
- **src/Typings/**: TypeScript type definitions for database and Discord structures.
- **src/Tests/**: Vitest-based test suite for core features (see `vitest.config.ts`).

## Developer Workflows
- **Build**: `npm run build` compiles TypeScript from `src/` to `build/`. Cleans old builds and checks types.
- **Test**: `npm test` runs all tests in `src/Tests/` using Vitest. Test files follow the `*.test.ts` naming convention.
- **Start**: `npm start` runs the compiled bot (`build/index.js`).
- **Register Commands**: `npm run register` registers Discord commands from the compiled output.
- **Type Checking**: `npm run check` (or `check:go` for alternate config) runs type checks only.

## Project-Specific Patterns & Conventions
- **Snapshots**: Central to the bot's recovery features. See `src/CRUD/Snapshots.ts` for creation, export, deletion, and pinning logic. Snapshots are versioned and can be exported/imported (see `src/Utils/Snapshots/Imports/`).
- **Validation**: All imported data (e.g., roles, channels, bans) is strictly validated using blueprint comparison and type guards (see `src/Utils/Snapshots/Imports/v1.ts`).
- **Caching**: LRU and Map-based caches are used for performance (e.g., snapshot and guild caches).
- **Database**: Uses MariaDB for persistent storage. All queries are parameterized. See `src/Database.ts` for connection logic.
- **Error Handling**: Custom error codes and logging via `src/Utils/Log.ts`. Many functions throw on validation or DB errors.
- **Extensibility**: New commands, buttons, menus, and modals are added as new files in their respective folders. Utilities are isolated for reuse.

## Integration Points
- **Discord.js**: Main library for Discord API interaction.
- **MariaDB**: Persistent storage for all bot data.
- **Environment Variables**: Managed via `dotenv`.
- **External Repos**: API, CDN, and Docs are maintained in separate repositories (see README).

## Examples & References
- **Snapshot Import/Export**: `src/Utils/Snapshots/Imports/v1.ts` (strict validation, blueprint comparison, and permission mapping).
- **CRUD Operations**: `src/CRUD/Snapshots.ts` (snapshot lifecycle), `src/CRUD/Users.ts`, etc.
- **Command Registration**: `src/RegisterCommands.ts` and `npm run register`.
- **Testing**: `src/Tests/` and `vitest.config.ts`.

## Notable Deviations from Common Practices
- **No traditional moderation commands**; focus is on data recovery and transparency.
- **Strict import validation**: All imported snapshot data is validated field-by-field, with custom error codes and logging.
- **Pinning and retention**: Snapshots can be pinned to prevent deletion; max snapshot count per guild is enforced.
- **Blueprint-based validation**: Used for all snapshot data imports (see `CompareBlueprint` usage).

## Quick Start for AI Agents
- Use the folder structure and naming conventions to locate or add new features.
- Always validate imported data using the established blueprint/type guard patterns.
- Reference `src/CRUD/Snapshots.ts` and `src/Utils/Snapshots/Imports/` for snapshot logic.
- Use provided scripts for builds, tests, and command registration.
- Follow the error handling and logging conventions for consistency.