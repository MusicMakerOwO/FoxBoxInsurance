import {ChannelType} from "discord.js";
import {SnapshotChannel} from "../../Typings/DatabaseTypes";

const TextChannelTypes = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
]);
const VoiceChannelTypes = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
const CategoryChannelTypes = new Set([ChannelType.GuildCategory]);

function GetSortableChannelTypes(type: number): Set<ChannelType> {
	switch (type) {
		case ChannelType.GuildText:
		case ChannelType.GuildAnnouncement:
		case ChannelType.GuildForum:
		case ChannelType.GuildMedia:
			return TextChannelTypes;
		case ChannelType.GuildVoice:
		case ChannelType.GuildStageVoice:
			return VoiceChannelTypes;
		case ChannelType.GuildCategory:
			return CategoryChannelTypes;
		default:
			return new Set([ type ]);
	}
}

export function SortChannels(channels: SnapshotChannel[]) {
	return Array.from(channels).sort((a, b) => {
		const aTypes = GetSortableChannelTypes(a.type);

		// If not in the same group, don't sort relative
		if (!aTypes.has(b.type)) return 0;

		// If not categories, sort within parent
		if (a.type !== ChannelType.GuildCategory && a.parent_id !== b.parent_id) return 0;

		// Primary sort: raw position
		if (a.position !== b.position) return a.position - b.position;

		// Tiebreaker: snowflake ID
		return BigInt(a.id) < BigInt(b.id) ? -1 : 1;
	});
}