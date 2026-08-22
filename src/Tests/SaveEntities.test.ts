import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getConnection, releaseConnection } = vi.hoisted(() => ({
	getConnection: vi.fn(),
	releaseConnection: vi.fn()
}));
vi.mock('../Database.js', () => ({ Database: { getConnection, releaseConnection } }));

import { SaveUser } from '../CRUD/Users.js';
import { SaveGuild } from '../CRUD/Guilds.js';
import { SaveChannel } from '../CRUD/Channels.js';
import { SimpleUser, SimpleGuild, SimpleChannel } from '../Typings/DatabaseTypes.js';

function makeConnection(err: Error) {
	return { query: vi.fn().mockRejectedValue(err) };
}

beforeEach(() => {
	getConnection.mockReset();
	releaseConnection.mockReset();
});

describe('SaveUser/SaveGuild/SaveChannel connection release', () => {
	it('releases the connection when SaveUser fails', async () => {
		const err = new Error('query failed');
		const connection = makeConnection(err);
		getConnection.mockResolvedValue(connection);

		const user: SimpleUser = { id: 1n, username: 'a', bot: 0, terms_version_accepted: 0, wrapped_key: null, rotation_hour: 0, opt_out_collection: 0 };

		await expect(SaveUser(user)).rejects.toThrow('query failed');
		expect(releaseConnection).toHaveBeenCalledWith(connection);
	});

	it('releases the connection when SaveGuild fails', async () => {
		const err = new Error('query failed');
		const connection = makeConnection(err);
		getConnection.mockResolvedValue(connection);

		const guild: SimpleGuild = { id: 1n, name: 'a', features: 0, last_restore: 0n };

		await expect(SaveGuild(guild)).rejects.toThrow('query failed');
		expect(releaseConnection).toHaveBeenCalledWith(connection);
	});

	it('releases the connection when SaveChannel fails', async () => {
		const err = new Error('query failed');
		const connection = makeConnection(err);
		getConnection.mockResolvedValue(connection);

		const channel: SimpleChannel = { id: 1n, guild_id: 1n, name: 'a', type: 0, block_exports: 0, last_purge: 0 };

		await expect(SaveChannel(channel)).rejects.toThrow('query failed');
		expect(releaseConnection).toHaveBeenCalledWith(connection);
	});
});
