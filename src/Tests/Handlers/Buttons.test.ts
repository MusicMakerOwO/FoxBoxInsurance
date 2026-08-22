import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonInteraction } from 'discord.js';
import { ButtonHandler } from '../../Typings/HandlerTypes.js';

const { CheckHandlerAccess } = vi.hoisted(() => ({ CheckHandlerAccess: vi.fn() }));
vi.mock('../../Utils/CheckHandlerAccess.js', () => ({ CheckHandlerAccess }));

const denialResponse = { embeds: [{ description: 'denied' }] };

const modalHandler: ButtonHandler = {
	customID      : 'test-modal',
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'modal',
	hidden        : true,
	execute       : vi.fn()
};

vi.mock('../../Client.js', () => ({
	client: { buttons: new Map([['test-modal', modalHandler]]) }
}));

const ButtonsHandler = (await import('../../Events/Handlers/Buttons.js')).default;

function makeInteraction(opts: { deferred: boolean; replied: boolean }): ButtonInteraction {
	return {
		customId: 'test-modal',
		deferred: opts.deferred,
		replied : opts.replied,
		reply   : vi.fn(),
		editReply: vi.fn()
	} as unknown as ButtonInteraction;
}

beforeEach(() => {
	CheckHandlerAccess.mockReset();
	CheckHandlerAccess.mockResolvedValue(denialResponse);
});

describe('Buttons handler - denial on unacknowledged interactions', () => {
	it('uses reply() when a modal-type handler is denied before being acknowledged', async () => {
		const interaction = makeInteraction({ deferred: false, replied: false });

		await ButtonsHandler.execute(interaction);

		expect(interaction.reply).toHaveBeenCalledWith(denialResponse);
		expect(interaction.editReply).not.toHaveBeenCalled();
	});

	it('uses editReply() when the interaction was already deferred', async () => {
		const interaction = makeInteraction({ deferred: true, replied: false });

		await ButtonsHandler.execute(interaction);

		expect(interaction.editReply).toHaveBeenCalledWith(denialResponse);
		expect(interaction.reply).not.toHaveBeenCalled();
	});
});
