import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonInteraction } from 'discord.js';
import { IClient } from '../../Client.js';
import { MAX_TOS_VERSION } from '../../TOSConstants.js';

const { SetUserTOSVersion } = vi.hoisted(() => ({ SetUserTOSVersion: vi.fn() }));
vi.mock('../../Services/UserTOS.js', () => ({ SetUserTOSVersion }));

import TOSAccept from '../../Buttons/TOSAccept.js';

function makeInteraction(userId = '900000000000000003'): ButtonInteraction {
	return { user: { id: userId } } as unknown as ButtonInteraction;
}

beforeEach(() => {
	SetUserTOSVersion.mockReset();
});

describe('TOSAccept', () => {
	it('accepts the version encoded in the custom_id args', async () => {
		const interaction = makeInteraction();

		await TOSAccept.execute(interaction, {} as IClient, ['2']);

		expect(SetUserTOSVersion).toHaveBeenCalledWith('900000000000000003', 2);
	});

	it('falls back to MAX_TOS_VERSION when no version arg is provided', async () => {
		const interaction = makeInteraction();

		await TOSAccept.execute(interaction, {} as IClient, [] as unknown as [string]);

		expect(SetUserTOSVersion).toHaveBeenCalledWith('900000000000000003', MAX_TOS_VERSION);
	});

	it('does not look up or require a guild - accepting works in DMs and any guild', async () => {
		const interaction = makeInteraction();

		const result = await TOSAccept.execute(interaction, { guilds: { cache: new Map() } } as unknown as IClient, ['1']);

		expect(SetUserTOSVersion).toHaveBeenCalledWith('900000000000000003', 1);
		expect('embeds' in result && result.embeds).toBeTruthy();
	});
});
