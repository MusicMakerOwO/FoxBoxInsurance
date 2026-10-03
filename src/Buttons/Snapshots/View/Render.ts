import {InteractionResponse} from "../../../Typings/HandlerTypes.js";
import {COLOR, EMOJI} from "../../../Utils/Constants.js";
import {RemoveFormatting} from "../../../Utils/RemoveFormatting.js";
import {DiscordActionRow, DiscordButton} from "../../../Typings/DiscordTypes.js";
import {GuildSnapshot} from "../../../Services/SnapshotLookup.js";

/**
 * The channel / role / ban lists shared by `snapshot-view-*` and `import-view-*` - the six handlers
 * only resolve what they are showing and where Back goes; paging, nav and formatting live here.
 */

export const PAGE_SIZE = 25;

export type ViewerKind = 'channels' | 'roles' | 'bans';

const KIND_TITLE: Record<ViewerKind, string> = {
	channels: 'Channels',
	roles   : 'Roles',
	bans    : 'Bans'
};

/** 25 lines of this plus the newlines between them stay under the 4096 char description limit */
const NAME_LIMIT = 120;

function ShortText(text = '', maxLength = 100) {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength - 3).trim() + '...';
}

/** RemoveFormatting can double a name's length, so shorten the raw name until the escaped one fits */
function EscapedName(name: string, maxLength = NAME_LIMIT): string {
	let escaped = RemoveFormatting(name);
	for (let keep = name.length - 1; escaped.length > maxLength && keep > 0; keep--) {
		escaped = RemoveFormatting(name.slice(0, keep).trim() + '...');
	}
	return escaped;
}

type Entries<T> = Map<unknown, T> | T[];

function Values<T>(entries: Entries<T>): T[] {
	return Array.isArray(entries) ? entries : Array.from(entries.values());
}

/** One line per entry, in the snapshot's own order - stored snapshots hold Maps, imports hold arrays */
export function ViewerLines(snapshot: GuildSnapshot, kind: ViewerKind): string[] {
	switch (kind) {
		case 'channels':
			return Values<{ name: string }>(snapshot.channels).map(channel => '#' + EscapedName(channel.name));
		case 'roles':
			return Values<{ name: string, managed_by: unknown }>(snapshot.roles).map(role =>
				`${role.managed_by ? EMOJI.BOT : ''} @${EscapedName(role.name)}`
			);
		case 'bans':
			return Values<{ id: unknown, reason: string | null }>(snapshot.bans).map(ban => {
				// A reason can span lines - keep it to the ban's own line
				const reason = (ban.reason ?? '').replace(/\s+/g, ' ').trim();
				return `<@${ban.id}> (${ban.id}) - ${RemoveFormatting(ShortText(reason || 'No reason provided', 50))}`;
			});
	}
}

/** Garbage or negative -> the first page, past the end -> the last page */
export function ParseViewerPage(input: string | undefined, pageCount: number): number {
	const page = parseInt(input ?? '', 10);
	if (isNaN(page) || page < 0) return 0;
	return Math.min(page, Math.max(pageCount - 1, 0));
}

export type Viewer = {
	/** The custom_id up to and including the snapshot / import id - the page is appended after it */
	prefix: string;
	/** `Snapshot #5` / `Import #XXXX-XXXX-XXXX-XXXX` */
	label : string;
	/** 'snapshot' / 'import', for the empty list message */
	source: string;
	kind  : ViewerKind;
	lines : string[];
	/** Where Back goes */
	back  : string;
};

export function RenderViewer(viewer: Viewer, pageInput: string | undefined): InteractionResponse {
	const total = viewer.lines.length;
	const pageCount = Math.ceil(total / PAGE_SIZE);
	const lastPage = Math.max(pageCount - 1, 0);
	const page = ParseViewerPage(pageInput, pageCount);

	const embed = {
		color: COLOR.PRIMARY,
		title: `${viewer.label} (${KIND_TITLE[viewer.kind]})`,
		description: total === 0
			? `No ${viewer.kind} found in this ${viewer.source} :(`
			: viewer.lines.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).join('\n'),
		footer: {
			text: `Total ${KIND_TITLE[viewer.kind]}: ${total}`
		}
	}

	// First and Last carry a trailing `_` so they never share a custom_id with Prev / Next
	const navButtons: DiscordActionRow<DiscordButton> = {
		type: 1,
		components: [
			{
				type: 2,
				style: 2,
				custom_id: `${viewer.prefix}_0_`,
				emoji: { name: EMOJI.FIRST_PAGE },
				disabled: page === 0
			},
			{
				type: 2,
				style: 2,
				custom_id: `${viewer.prefix}_${page - 1}`,
				emoji: { name: EMOJI.PREVIOUS_PAGE },
				disabled: page === 0
			},
			{
				type: 2,
				style: 2,
				custom_id: 'null',
				label: `Page ${page + 1} / ${pageCount}`,
				disabled: true
			},
			{
				type: 2,
				style: 2,
				custom_id: `${viewer.prefix}_${page + 1}`,
				emoji: { name: EMOJI.NEXT_PAGE },
				disabled: page >= lastPage
			},
			{
				type: 2,
				style: 2,
				custom_id: `${viewer.prefix}_${lastPage}_`,
				emoji: { name: EMOJI.LAST_PAGE },
				disabled: page >= lastPage
			}
		]
	}

	const backButton: DiscordActionRow<DiscordButton> = {
		type: 1,
		components: [
			{
				type: 2,
				style: 4,
				custom_id: viewer.back,
				label: 'Back'
			}
		]
	}

	return {
		embeds: [embed],
		components: total > PAGE_SIZE ? [navButtons, backButton] : [backButton]
	}
}

export function SnapshotNotFound(): InteractionResponse {
	return {
		embeds: [{
			color: COLOR.ERROR,
			title: 'Snapshot Not Found',
			description: `
Snapshot not found or already deleted
Create one using \`/snapshot create\``
		}],
		components: []
	}
}

export function ImportNotFound(): InteractionResponse {
	return {
		embeds: [{
			color: COLOR.ERROR,
			title: 'Import Not Found',
			description: 'The import does not exist or has expired.\nPlease import the file and try again.'
		}],
		components: []
	}
}
