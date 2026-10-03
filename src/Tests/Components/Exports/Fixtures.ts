import { IClient } from '../../../Client.js';
import { ChannelExport, CreateExportCacheKey } from '../../../Typings/CacheEntries.js';
import { FORMAT } from '../../../Utils/Constants.js';
import { MAX_TOS_VERSION } from '../../../TOSConstants.js';
import { GUILD_FEATURES } from '../../../Typings/DatabaseTypes.js';
import { MockInteraction, makeInteraction } from '../Helpers.js';

/**
 * Shared fixtures for the export flow suites - no tests of its own, and no `vi.mock`s (those have to
 * live in each test file to be hoisted).
 */

export const GUILD_ID   = '900000000000000006';
export const USER_ID    = '900000000000000005';
/** The channel `/export` was run in - the session is keyed on it, whatever channel is being exported */
export const CHANNEL_ID = '900000000000000008';
/** A second channel to export from, picked through the channel modal */
export const OTHER_CHANNEL_ID = '900000000000000009';

export const SESSION_KEY = CreateExportCacheKey(CHANNEL_ID, USER_ID);

export const TIMEOUT_TEXT = 'Your session has timed out - Please re-run the command';

/** Puts a session where `/export` would, returning it so a test can watch it being mutated */
export function seedSession(client: IClient, overrides: Partial<ChannelExport> = {}): ChannelExport {
	const session: ChannelExport = {
		guildID     : BigInt(GUILD_ID),
		channelID   : BigInt(CHANNEL_ID),
		userID      : BigInt(USER_ID),
		format      : FORMAT.HTML,
		messageCount: 100,
		...overrides
	};
	client.exportCache.set(SESSION_KEY, session);
	return session;
}

/** Every key currently in the session cache, expired or not */
export function cacheKeys(client: IClient): string[] {
	return [ ...client.exportCache.cache.keys() ];
}

export function interaction(options: Parameters<typeof makeInteraction>[0] = {}): MockInteraction {
	return makeInteraction({ guildId: GUILD_ID, userId: USER_ID, channelId: CHANNEL_ID, memberPerms: [], ...options });
}

/** What `GetUser` / `GetGuild` return so every export handler's gates pass */
export const OPEN_GATES = {
	user : { terms_version_accepted: MAX_TOS_VERSION },
	guild: { features: GUILD_FEATURES.EXPORT_MESSAGES }
};

/**
 * Runs a click or submit through the real dispatcher, so the test sees what was actually sent.
 * The caller must mock `Client.js` (the dispatcher looks handlers up on the singleton) and stub
 * `GetUser` / `GetGuild` with `OPEN_GATES`.
 */
export async function dispatch(kind: 'button' | 'modal', customId: string, options: Parameters<typeof makeInteraction>[0] = {}): Promise<MockInteraction> {
	const events = kind === 'button'
		? (await import('../../../Events/Handlers/Buttons.js')).default
		: (await import('../../../Events/Handlers/Modals.js')).default;

	const sent = interaction({ kind, customId, ...options });
	await events.execute(sent);
	return sent;
}
