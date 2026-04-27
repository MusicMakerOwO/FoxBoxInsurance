import { ObjectValues } from "./HelperTypes";
import { APIEmbed, APIMessageTopLevelComponent } from "discord-api-types/v10";
import { FORMAT, SNAPSHOT_TYPE } from "../Utils/Constants";
import { JSONStringify } from "../JSON";

export const ASSET_TYPE = {
	GUILD     : 0,
	USER      : 1,
	EMOJI     : 2,
	STICKER   : 3,
	ATTACHMENT: 4
} as const;

/** Server owner and admins can override any of these except for MESSAGE_SAVING */
export const GUILD_FEATURES = {
	/** Snapshots are created automatically every 24 hours */
	AUTOMATIC_SNAPSHOTS: 1 << 0,
	/** Automatic snapshots are still enabled but guilds cannot create or delete them manually */
	MANAGE_SNAPSHOTS: 1 << 1,
	/** Allows importing snapshots from a file */
	IMPORT_SNAPSHOTS: 1 << 2,
	/** Allows users the ability to export any channel they can access normally (i.e. can view channel and is not banned from exporting) */
	EXPORT_MESSAGES: 1 << 3,
	/** If this is enabled, no newer messages will be saved but channels can still export existing data */
	MESSAGE_SAVING: 1 << 4
} as const;

export type Asset = {
	discord_id: bigint,
	type: ObjectValues<typeof ASSET_TYPE>,

	discord_url: string,

	name: string,

	/** Null if not an image */
	width: number | null,
	/** Null if not an image */
	height: number | null,
	/** file size in bytes */
	size: number,

	/** This will be set after successfully uploading */
	hash: string | null
}

export type SimpleGuild = {
	id: bigint,
	name: string,
	/** A bitfield of GUILD_FEATURES */
	features: number,
	last_restore: bigint,
}

export type SimpleGuildBlock = {
	guild_id: bigint,
	user_id: bigint,
	/** Who is responsible for the block? Null if automatic */
	moderator_id: bigint | null,
}

export type SimpleChannel = {
	id: bigint,
	guild_id: bigint,
	name: string,
	type: number,
	block_exports: 1 | 0
	last_purge: number
}

export type SimpleUser = {
	id: bigint,
	username: string,
	bot: 1 | 0,
	terms_version_accepted: number,
	wrapped_key: Buffer | null,
	rotation_hour: number
}

export type SimpleEmoji = {
	id: bigint,
	name: string,
	animated: 1 | 0
}

export type SimpleSticker = {
	id: bigint,
	name: string
}

export type SimpleAttachment = {
	id: bigint,
	name: string
}

export type SimpleMessage = {
	id: bigint,
	guild_id: bigint,
	channel_id: bigint,
	user_id: bigint,

	/* either ASCII text or a wrapped key, refer to the encryption version to know which */
	content: Buffer | null,
	sticker_id: bigint | null,
	reply_to: bigint | null,

	/** Null if not encrypted */
	encryption_version: number | null,

	data: {
		attachments: JSONStringify<SimpleAttachment>[],
		emoji_ids: JSONStringify<SimpleEmoji['id']>[],
		embeds: APIEmbed[],
		components: APIMessageTopLevelComponent[],
	},

	length: number | null,
	created_at: Date
}

export type SnapshotMetadata = {
	id: number,
	guild_id: bigint,
	type: typeof SNAPSHOT_TYPE.MANUAL | typeof SNAPSHOT_TYPE.AUTOMATIC,
	pinned: 1 | 0,
	created_at: Date,
}

export type SnapshotRole = {
	snapshot_id: number,
	deleted: 1 | 0,

	id: bigint,
	name: string,
	color: number,
	hoist: number,
	position: number,
	permissions: bigint,
	managed_by: bigint | null
}

export type SnapshotChannel = {
	snapshot_id: number,
	deleted: 1 | 0,

	id: bigint,
	type: number,
	name: string,
	position: number,
	topic: string | null,
	nsfw: 1 | 0,
	parent_id: bigint | null,

	/**
	 * Key is a role ID or user ID - must be converted to string for JSON conversions
	 */
	permission_overwrites: Record<string, JSONStringify<SnapshotChannelOverwrite>>
}

export const OVERWRITE_TYPE = {
	ROLE: 0,
	USER: 1
} as const;

export type SnapshotChannelOverwrite = {
	allow: bigint,
	deny: bigint,
	/** 0 = Role, 1 = User */
	type: typeof OVERWRITE_TYPE.ROLE
		| typeof OVERWRITE_TYPE.USER
}

// export type SnapshotPermission = {
// 	snapshot_id: number,
// 	deleted: 1 | 0,
//
// 	channel_id: bigint,
// 	id: bigint,
//
// 	/** Role = 0, User = 1 */
// 	type: 0 | 1,
//
// 	allow: bigint,
// 	deny: bigint,
// }

export type SnapshotBan = {
	snapshot_id: number,
	deleted: 1 | 0,

	id: bigint,
	reason: string
}

export type SimpleMessageExport = {
	id: string,
	guild_id: bigint,
	channel_id: bigint,
	user_id: bigint,
	message_count: number,
	format: ObjectValues<typeof FORMAT>,
	hash: string,
	hash_algorithm: string,
	lookup: string,
	/** Unix timestamp in seconds */
	created_at: number,
}

export type SnapshotExportMetadata = {
	// XXXX-XXXX-XXXX-XXXX
	id: string,
	snapshot_id: SnapshotMetadata['id'],
	guild_id: SimpleGuild['id'],
	user_id: SimpleUser['id'],
	length: number,
	version: number,
	hash: string,
	algorithm: string,
	revoked: 1 | 0
}