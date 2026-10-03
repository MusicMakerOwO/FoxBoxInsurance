import { describe, it, expect, vi } from 'vitest';
import { InteractionResponse } from '../../Typings/HandlerTypes.js';
import { DiscordButton, DiscordStringSelect } from '../../Typings/DiscordTypes.js';
import { ExpectValidModal, ExpectValidResponse, HandlerResult } from '../Components/Helpers.js';

/**
 * Tests the response contract itself against hand-built good and bad payloads, so every suite that
 * leans on `ExpectValidResponse` / `ExpectValidModal` can trust a pass. Each bad payload breaks
 * exactly one rule and asserts the message names it.
 */

// The helpers load the real handler barrels to check routing; nothing here should reach the DB
const { query } = vi.hoisted(() => ({ query: vi.fn(() => { throw new Error('unexpected query'); }) }));
vi.mock('../../Database.js', () => ({ Database: { query } }));

const UPDATE = { response_type: 'update' } as const;
const REPLY = { response_type: 'reply' } as const;

function button(custom_id: string, extra: Partial<DiscordButton> = {}): DiscordButton {
	return { type: 2, style: 2, label: 'Go', custom_id, ...extra } as DiscordButton;
}

function select(custom_id: string, count: number, extra: Partial<DiscordStringSelect> = {}): DiscordStringSelect {
	return {
		type: 3,
		custom_id,
		options: Array.from({ length: count }, (_, i) => ({ label: `Option ${i}`, value: String(i) })),
		...extra
	};
}

function response(overrides: Partial<InteractionResponse> = {}): InteractionResponse {
	return {
		embeds: [{ title: 'Title', description: 'Body' }],
		components: [
			{ type: 1, components: [ button('close'), button('snapshot-list'), { type: 2, style: 5, label: 'Docs', url: 'https://notfbi.dev' } ] },
			{ type: 1, components: [ select('exportInfo', 3) ] }
		],
		...overrides
	};
}

const TEXT_ROW = {
	type: 1,
	components: [{ type: 4, custom_id: 'data', label: 'Timezone', style: 1, placeholder: 'EST', required: true }]
};

function modal(overrides: Record<string, unknown> = {}): HandlerResult {
	return {
		title: 'Set Your Timezone',
		custom_id: 'set-timezone_week',
		components: [ TEXT_ROW ],
		...overrides
	} as HandlerResult;
}

describe('ExpectValidResponse', () => {
	it('accepts a well-formed screen', async () => {
		await expect(ExpectValidResponse(response(), UPDATE)).resolves.toBeUndefined();
	});

	it('accepts a delete marker without checking anything else', async () => {
		await expect(ExpectValidResponse({ delete: true }, UPDATE)).resolves.toBeUndefined();
	});

	it('rejects a modal', async () => {
		await expect(ExpectValidResponse(modal(), UPDATE)).rejects.toThrow(/got a modal/);
	});

	it('rejects more than 5 action rows', async () => {
		const rows = Array.from({ length: 6 }, (_, i) => ({ type: 1 as const, components: [ button(`snapshot-list_${i}`) ] }));
		await expect(ExpectValidResponse(response({ components: rows }), UPDATE)).rejects.toThrow(/6 action rows/);
	});

	it('rejects more than 5 buttons in a row', async () => {
		const row = { type: 1 as const, components: Array.from({ length: 6 }, (_, i) => button(`snapshot-list_${i}`)) };
		await expect(ExpectValidResponse(response({ components: [ row ] }), UPDATE)).rejects.toThrow(/6 buttons/);
	});

	it('rejects a select that shares its row', async () => {
		const row = { type: 1, components: [ select('exportInfo', 2), button('close') ] } as never;
		await expect(ExpectValidResponse(response({ components: [ row ] }), UPDATE)).rejects.toThrow(/select sharing its row/);
	});

	it.each([ 0, 26 ])('rejects a select with %i options', async (count) => {
		const row = { type: 1 as const, components: [ select('exportInfo', count) ] };
		await expect(ExpectValidResponse(response({ components: [ row ] }), UPDATE)).rejects.toThrow(new RegExp(`${count} options`));
	});

	it('accepts a select with exactly 25 options', async () => {
		const row = { type: 1 as const, components: [ select('exportInfo', 25) ] };
		await expect(ExpectValidResponse(response({ components: [ row ] }), UPDATE)).resolves.toBeUndefined();
	});

	it('rejects duplicate option values within one select', async () => {
		const dupes = select('exportInfo', 2);
		dupes.options[1].value = dupes.options[0].value;
		await expect(ExpectValidResponse(response({ components: [{ type: 1, components: [ dupes ] }] }), UPDATE)).rejects.toThrow(/duplicate option values/);
	});

	it.each([ 'label', 'value', 'description' ] as const)('rejects an option %s over 100 chars', async (field) => {
		const long = select('exportInfo', 1);
		long.options[0][field] = 'x'.repeat(101);
		await expect(ExpectValidResponse(response({ components: [{ type: 1, components: [ long ] }] }), UPDATE)).rejects.toThrow(new RegExp(`option ${field} .* 101 chars`));
	});

	it('accepts option text of exactly 100 chars', async () => {
		const edge = select('exportInfo', 1);
		edge.options[0] = { label: 'x'.repeat(100), value: 'y'.repeat(100), description: 'z'.repeat(100) };
		await expect(ExpectValidResponse(response({ components: [{ type: 1, components: [ edge ] }] }), UPDATE)).resolves.toBeUndefined();
	});

	it('rejects a button label over 80 chars', async () => {
		const row = { type: 1 as const, components: [ button('close', { label: 'x'.repeat(81) }) ] };
		await expect(ExpectValidResponse(response({ components: [ row ] }), UPDATE)).rejects.toThrow(/label is 81 chars/);
	});

	it('rejects a custom_id over 100 chars', async () => {
		const row = { type: 1 as const, components: [ button(`snapshot-list_${'1'.repeat(90)}`) ] };
		await expect(ExpectValidResponse(response({ components: [ row ] }), UPDATE)).rejects.toThrow(/104 chars, over 100/);
	});

	it('rejects a custom_id duplicated within the same message', async () => {
		const rows = [
			{ type: 1 as const, components: [ button('close') ] },
			{ type: 1 as const, components: [ button('close') ] }
		];
		await expect(ExpectValidResponse(response({ components: rows }), UPDATE)).rejects.toThrow(/'close' is duplicated/);
	});

	it('rejects a link button with a custom_id', async () => {
		const link = { type: 2, style: 5, label: 'Docs', url: 'https://notfbi.dev', custom_id: 'close' } as unknown as DiscordButton;
		await expect(ExpectValidResponse(response({ components: [{ type: 1, components: [ link ] }] }), UPDATE)).rejects.toThrow(/link button with a custom_id/);
	});

	it('rejects a non-link button without a custom_id', async () => {
		const bare = { type: 2, style: 1, label: 'Go' } as unknown as DiscordButton;
		await expect(ExpectValidResponse(response({ components: [{ type: 1, components: [ bare ] }] }), UPDATE)).rejects.toThrow(/has no custom_id/);
	});

	it('rejects a button whose prefix has no button handler', async () => {
		const row = { type: 1 as const, components: [ button('not-a-handler_1') ] };
		await expect(ExpectValidResponse(response({ components: [ row ] }), UPDATE)).rejects.toThrow(/no handler in the buttons map/);
	});

	it('rejects a button routed at a menu-only prefix', async () => {
		const row = { type: 1 as const, components: [ button('exportInfo') ] };
		await expect(ExpectValidResponse(response({ components: [ row ] }), UPDATE)).rejects.toThrow(/no handler in the buttons map/);
	});

	it('rejects a select routed at a button-only prefix', async () => {
		const row = { type: 1 as const, components: [ select('close', 2) ] };
		await expect(ExpectValidResponse(response({ components: [ row ] }), UPDATE)).rejects.toThrow(/no handler in the menus map/);
	});

	it('allows the null placeholder only on a disabled button', async () => {
		const disabled = { type: 1 as const, components: [ button('null', { disabled: true }) ] };
		const enabled = { type: 1 as const, components: [ button('null') ] };

		await expect(ExpectValidResponse(response({ components: [ disabled ] }), UPDATE)).resolves.toBeUndefined();
		await expect(ExpectValidResponse(response({ components: [ enabled ] }), UPDATE)).rejects.toThrow(/placeholder but is not disabled/);
	});

	it('rejects an embed title over 256 chars', async () => {
		await expect(ExpectValidResponse(response({ embeds: [{ title: 'x'.repeat(257) }] }), UPDATE)).rejects.toThrow(/title is 257 chars/);
	});

	it('rejects an embed description over 4096 chars', async () => {
		await expect(ExpectValidResponse(response({ embeds: [{ description: 'x'.repeat(4097) }] }), UPDATE)).rejects.toThrow(/description is 4097 chars/);
	});

	it('accepts an embed description of exactly 4096 chars', async () => {
		await expect(ExpectValidResponse(response({ embeds: [{ description: 'x'.repeat(4096) }] }), UPDATE)).resolves.toBeUndefined();
	});

	it('rejects an embed footer over 2048 chars', async () => {
		await expect(ExpectValidResponse(response({ embeds: [{ footer: { text: 'x'.repeat(2049) } }] }), UPDATE)).rejects.toThrow(/footer is 2049 chars/);
	});

	it('rejects embeds holding more than 6000 chars combined', async () => {
		const embeds = [{ title: 'x'.repeat(100), description: 'x'.repeat(4000) }, { description: 'x'.repeat(1901) }];
		await expect(ExpectValidResponse(response({ embeds }), UPDATE)).rejects.toThrow(/6001 chars combined/);
		embeds[1].description = 'x'.repeat(1900);
		await expect(ExpectValidResponse(response({ embeds }), UPDATE)).resolves.toBeUndefined();
	});

	it('rejects more than 10 embeds', async () => {
		const embeds = Array.from({ length: 11 }, () => ({ description: 'x' }));
		await expect(ExpectValidResponse(response({ embeds }), UPDATE)).rejects.toThrow(/11 embeds/);
	});

	it.each([ [ 'ephemeral', true ], [ 'flags', 64 ] ])('rejects the %s key editReply ignores', async (key, value) => {
		const result = { ...response(), [key]: value } as InteractionResponse;
		await expect(ExpectValidResponse(result, REPLY)).rejects.toThrow(new RegExp(`'${key}' is ignored`));
	});

	it('rejects an update response that omits components', async () => {
		await expect(ExpectValidResponse({ embeds: [{ description: 'gone' }] }, UPDATE)).rejects.toThrow(/must set 'components'/);
	});

	it('accepts an update response that clears components with []', async () => {
		await expect(ExpectValidResponse({ embeds: [{ description: 'gone' }], components: [] }, UPDATE)).resolves.toBeUndefined();
	});

	it('lets a reply response omit components - it is a fresh message', async () => {
		await expect(ExpectValidResponse({ embeds: [{ description: 'new' }] }, REPLY)).resolves.toBeUndefined();
	});

	// The dispatcher sends a follow-up and leaves the message alone, so the update rule can't apply
	it('accepts a follow-up-only response on an update handler', async () => {
		await expect(ExpectValidResponse({ followUp: { embeds: [{ description: 'nope' }] } }, UPDATE)).resolves.toBeUndefined();
	});

	it.each([
		[ 'embeds', { embeds: [{ description: 'dropped' }] } ],
		[ 'components', { components: [] } ]
	])('rejects a follow-up alongside %s - the dispatcher would drop them', async (key, extra) => {
		const result = { followUp: { embeds: [{ description: 'nope' }] }, ...extra } as InteractionResponse;
		await expect(ExpectValidResponse(result, UPDATE)).rejects.toThrow(new RegExp(`must set nothing else, got '${key}'`));
	});

	it('holds the follow-up payload to the same limits', async () => {
		const result = { followUp: { embeds: [{ title: 'x'.repeat(257) }] } };
		await expect(ExpectValidResponse(result, UPDATE)).rejects.toThrow(/title is 257 chars/);
	});

	it('rejects flags inside the follow-up - the dispatcher makes it ephemeral', async () => {
		const result = { followUp: { embeds: [{ description: 'nope' }], flags: 64 } as InteractionResponse };
		await expect(ExpectValidResponse(result, UPDATE)).rejects.toThrow(/'flags' is ignored/);
	});

	it('reports every broken rule at once', async () => {
		const result = { embeds: [{ title: 'x'.repeat(300) }], ephemeral: true } as InteractionResponse;
		await expect(ExpectValidResponse(result, UPDATE)).rejects.toThrow(/ephemeral[\s\S]*components[\s\S]*title/);
	});
});

describe('ExpectValidModal', () => {
	it('accepts a well-formed modal', async () => {
		await expect(ExpectValidModal(modal())).resolves.toBeUndefined();
	});

	it('accepts a label component wrapping a select', async () => {
		const labelled = modal({
			custom_id: 'export-channel',
			components: [{ type: 18, label: 'Select the channel to export from', component: { type: 8, custom_id: 'data', required: true } }]
		});
		await expect(ExpectValidModal(labelled)).resolves.toBeUndefined();
	});

	it('rejects an interaction response', async () => {
		await expect(ExpectValidModal(response())).rejects.toThrow(/expected a modal/);
	});

	it('rejects a title over 45 chars', async () => {
		await expect(ExpectValidModal(modal({ title: 'x'.repeat(46) }))).rejects.toThrow(/title is 46 chars/);
	});

	it.each([ 0, 6 ])('rejects %i components', async (count) => {
		await expect(ExpectValidModal(modal({ components: Array.from({ length: count }, () => TEXT_ROW) })))
			.rejects.toThrow(new RegExp(`${count} components`));
	});

	it('rejects a custom_id prefix with no modal handler', async () => {
		await expect(ExpectValidModal(modal({ custom_id: 'snapshot-list' }))).rejects.toThrow(/no handler in the modals map/);
	});

	it('rejects a text input label over 45 chars', async () => {
		const long = modal({ components: [{ type: 1, components: [{ type: 4, custom_id: 'data', label: 'x'.repeat(46), style: 1 }] }] });
		await expect(ExpectValidModal(long)).rejects.toThrow(/label is 46 chars/);
	});

	it('rejects a label component over 45 chars', async () => {
		const long = modal({ components: [{ type: 18, label: 'x'.repeat(46), component: { type: 8, custom_id: 'data' } }] });
		await expect(ExpectValidModal(long)).rejects.toThrow(/46 chars, over 45/);
	});

	it('rejects a placeholder over 100 chars', async () => {
		const long = modal({ components: [{ type: 1, components: [{ type: 4, custom_id: 'data', label: 'Timezone', style: 1, placeholder: 'x'.repeat(101) }] }] });
		await expect(ExpectValidModal(long)).rejects.toThrow(/placeholder is 101 chars/);
	});
});
