import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonInteraction } from 'discord.js';
import { IClient } from '../../Client.js';

const { GetSnapshot, ExportSnapshot } = vi.hoisted(() => ({
	GetSnapshot: vi.fn(),
	ExportSnapshot: vi.fn()
}));
vi.mock('../../CRUD/Snapshots.js', () => ({ GetSnapshot, ExportSnapshot }));

const { UploadCDN } = vi.hoisted(() => ({ UploadCDN: vi.fn() }));
vi.mock('../../Utils/UploadCDN.js', () => ({ UploadCDN }));

vi.mock('../../Utils/Snapshots/Imports/Parse.js', () => ({ SnapshotParsers: { 2: vi.fn() } }));

import SnapshotExport from '../../Buttons/Snapshots/Export.js';

function makeInteraction(guildId: string, userId = '900000000000000003'): ButtonInteraction {
	return { guildId, user: { id: userId } } as unknown as ButtonInteraction;
}

beforeEach(() => {
	GetSnapshot.mockReset();
	ExportSnapshot.mockReset();
	UploadCDN.mockReset();
	UploadCDN.mockResolvedValue('lookup-id');
});

describe('Buttons/Snapshots/Export', () => {
	it('refuses to export a snapshot belonging to a different guild', async () => {
		GetSnapshot.mockResolvedValue({ guild_id: 111n });

		const result = await SnapshotExport.execute(makeInteraction('222'), {} as IClient, ['5']);

		expect('embeds' in result && result.embeds?.[0]).toMatchObject({ title: 'Snapshot Not Found' });
		expect(ExportSnapshot).not.toHaveBeenCalled();
		expect(UploadCDN).not.toHaveBeenCalled();
	});

	it('exports a snapshot that belongs to the requesting guild', async () => {
		GetSnapshot.mockResolvedValue({ guild_id: 111n });
		ExportSnapshot.mockResolvedValue({ data: { id: 'EXPT-0000', version: 2 }, serialized: '{"id":"EXPT-0000"}' });

		const result = await SnapshotExport.execute(makeInteraction('111'), {} as IClient, ['5']);

		expect(ExportSnapshot).toHaveBeenCalledWith(5, 900000000000000003n);
		expect(UploadCDN).toHaveBeenCalledWith('snapshot-5.json', Buffer.from('{"id":"EXPT-0000"}', 'utf8'), 1);
		expect('embeds' in result && result.embeds?.[0].description).toContain('EXPT-0000');
	});
});
