-- This is a lookup for every single stored asset in the system
-- Things like icons, images, videos, stickers/emojis, etc
-- If a user or guild has an icon it will show up in here with an ID
CREATE TABLE IF NOT EXISTS Assets (
	asset_id INTEGER PRIMARY KEY AUTOINCREMENT,

	-- Avoid storing duplicates, this is only a lookup for the storage location : [HASH].[EXTENSION]
	url TEXT NOT NULL UNIQUE,
	hash TEXT NOT NULL,
	fileName TEXT ALWAYS AS (hash || '.' || extension) VIRTUAL,

	id TEXT NOT NULL, -- Discord Snowflake
	extension TEXT NOT NULL,

	width INTEGER,
	height INTEGER,
	size INTEGER,
	
	created_at DATETIME GENERATED ALWAYS AS ({{SNOWFLAKE_DATE}}) VIRTUAL
);
CREATE INDEX IF NOT EXISTS assets_hash ON Assets (hash);
CREATE INDEX IF NOT EXISTS assets_url  ON Assets (url);

CREATE TABLE IF NOT EXISTS Guilds (
	id TEXT NOT NULL PRIMARY KEY, -- Discord Snowflake
	name TEXT NOT NULL,
	asset_id INTEGER,
	-- {{...}} denotes an external macro, see Utils/Database for available macros
	createdAt DATETIME GENERATED ALWAYS AS ({{SNOWFLAKE_DATE}}) VIRTUAL
);

CREATE TABLE IF NOT EXISTS Users (
	id TEXT NOT NULL PRIMARY KEY,
	username TEXT NOT NULL,
	bot INTEGER NOT NULL DEFAULT 0,
	asset_id INTEGER,
	createdAt DATETIME GENERATED ALWAYS AS ({{SNOWFLAKE_DATE}}) VIRTUAL
);

CREATE TABLE IF NOT EXISTS Members (
	user_id TEXT NOT NULL,
	guild_id TEXT NOT NULL,
	joined_at DATETIME,
	left_at DATETIME,
	PRIMARY KEY(user_id, guild_id)
);

CREATE TABLE IF NOT EXISTS Channels (
	id TEXT NOT NULL PRIMARY KEY,
	guild_id TEXT NOT NULL,
	name TEXT NOT NULL,
	parent_id TEXT,
	type INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS Emojis (
	id TEXT NOT NULL PRIMARY KEY,
	name TEXT NOT NULL,
	animated INTEGER NOT NULL DEFAULT 0,
	asset_id INTEGER,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Stickers (
	id TEXT NOT NULL PRIMARY KEY,
	name TEXT NOT NULL,
	asset_id INTEGER,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Attachments (
	id TEXT NOT NULL PRIMARY KEY,
	name TEXT NOT NULL,
	message_id TEXT NOT NULL,
	asset_id INTEGER,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS attachments_message_id ON Attachments (message_id);

/*
export interface BasicEmbed {
	// This is here for completeness and avoid nested loops
	// It's a little bit more ram but the coede is simpler
	messageID: string;

	title: string | null;
	description: string | null;
	url: string | null;
	timestamp: string | null;
	color: number | null;

	// Unwraping objects make it easier for the database
	footer_text: string | null;
	footer_icon: string | null;

	thumbnail_url: string | null;

	image_url: string | null;

	author_name: string | null;
	author_url: string | null;
	author_icon: string | null;

	fields: EmbedField[];
}

export interface EmbedField {
	name: string;
	value: string;
	inline?: boolean;
}
*/

CREATE TABLE IF NOT EXISTS Embeds (
	id TEXT NOT NULL PRIMARY KEY,
	message_id TEXT NOT NULL,
	title TEXT,
	description TEXT,
	url TEXT,
	timestamp TEXT,
	color INTEGER,
	footer_text TEXT,
	footer_icon TEXT,
	thumbnail_url TEXT,
	image_url TEXT,
	author_name TEXT,
	author_url TEXT,
	author_icon TEXT
);

CREATE TABLE IF NOT EXISTS EmbedFields (
	id INTEGER PRIMARY KEY AUTOINCREMENT, -- Only used for ordering, this has no impact on the data
	embed_id TEXT NOT NULL,
	name TEXT NOT NULL,
	value TEXT NOT NULL,
	inline INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Messages (
	id TEXT NOT NULL PRIMARY KEY,
	guild_id TEXT NOT NULL,
	channel_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	content TEXT,
	sticker_id TEXT,
	created_at DATETIME GENERATED ALWAYS AS ({{SNOWFLAKE_DATE}}) VIRTUAL
);

CREATE TABLE IF NOT EXISTS MessageEmojis (
	message_id TEXT NOT NULL,
	emoji_id TEXT NOT NULL,
	PRIMARY KEY(message_id, emoji_id)
);
CREATE INDEX IF NOT EXISTS message_emojis_emoji_id ON MessageEmojis (emoji_id);
CREATE INDEX IF NOT EXISTS message_emojis_message_id ON MessageEmojis (message_id);





CREATE TABLE IF NOT EXISTS Backups (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id TEXT NOT NULL,
	type INTEGER NOT NULL, -- Manual, auto, import, etc.
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	expires_at DATETIME NOT NULL DEFAULT (DATE('now', '+7 days'))
);
CREATE INDEX IF NOT EXISTS backups_guild_id ON Backups (guild_id);

CREATE TABLE IF NOT EXISTS BackupChannel (
	backup_id INTEGER NOT NULL REFERENCES Backups(id) ON DELETE CASCADE,
	parent_id TEXT,
	channel_id TEXT NOT NULL,
	type INTEGER NOT NULL,
	name TEXT NOT NULL,
	PRIMARY KEY(backup_id, channel_id)
);
CREATE INDEX IF NOT EXISTS backup_channel_parent_id ON BackupChannel (parent_id);
CREATE INDEX IF NOT EXISTS backup_channel_channel_id ON BackupChannel (channel_id);

CREATE TABLE IF NOT EXISTS BackupRole (
	backup_id INTEGER NOT NULL REFERENCES Backups(id) ON DELETE CASCADE,
	role_id TEXT NOT NULL,
	name TEXT NOT NULL,
	color INTEGER NOT NULL,
	hoist INTEGER NOT NULL,
	position INTEGER NOT NULL,
	permissions INTEGER NOT NULL,
	mentionable INTEGER NOT NULL,
	PRIMARY KEY(backup_id, role_id)
);
CREATE INDEX IF NOT EXISTS backup_role_role_id ON BackupRole (role_id);

CREATE TABLE IF NOT EXISTS BackupChannelOverrides (
	backup_id INTEGER NOT NULL REFERENCES Backups(id) ON DELETE CASCADE,
	channel_id TEXT NOT NULL,
	role_id TEXT NOT NULL,
	allow INTEGER NOT NULL,
	deny INTEGER NOT NULL,
	PRIMARY KEY(backup_id, channel_id, role_id)
);
CREATE INDEX IF NOT EXISTS backup_channel_overrides_channel_id ON BackupChannelOverrides (channel_id);
CREATE INDEX IF NOT EXISTS backup_channel_overrides_role_id ON BackupChannelOverrides (role_id);




/*
export interface ExportData {
	data: Buffer;
	filename: string; // Export-<channelName>.<format>
	size: number; // In bytes
	hash: string; // md5
	exportID: string;
}
*/

CREATE TABLE IF NOT EXISTS Exports (
	id TEXT NOT NULL PRIMARY KEY,

	guild_id TEXT NOT NULL,
	channel_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	
	format TEXT NOT NULL,
	filename TEXT NOT NULL,
	size INTEGER NOT NULL,
	hash TEXT NOT NULL,

	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS exports_user_id ON Exports (user_id);