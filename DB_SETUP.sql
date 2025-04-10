-- NodeJS can only make timers so long
-- For long running tasks like channel purging we need a more permanent solution
-- This will keep the run time data even on restart
CREATE TABLE IF NOT EXISTS Timers (
	id TEXT NOT NULL PRIMARY KEY,
	last_run INTEGER NOT NULL DEFAULT ( UNIXEPOCH('now', 'localtime') )
);

-- This is a lookup for every single stored asset in the system
-- Things like icons, images, videos, stickers/emojis, etc
-- If a user or guild has an icon it will show up in here with an ID
CREATE TABLE IF NOT EXISTS Assets (
	asset_id INTEGER PRIMARY KEY AUTOINCREMENT,
	discord_id TEXT NOT NULL, -- Discord ID of whatever this asset represents
	type INTEGER NOT NULL,

	-- The URL to the asset on Discord's servers, may return 404 if they delete it
	-- For long term retrievale use the cdn server and lookup by hash
	discord_url TEXT NOT NULL UNIQUE,

	name TEXT NOT NULL, -- Original file name
	extension TEXT NOT NULL,
	fileName TEXT GENERATED ALWAYS AS (name || '.' || extension) VIRTUAL, -- The file name of the asset

	width INTEGER,
	height INTEGER,
	size INTEGER, -- in bytes

	hash TEXT, -- this will be set after uploading to the cdn server
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	uploaded INTEGER NOT NULL DEFAULT 0 -- 1 if the file is uploaded to the storage
) STRICT;
CREATE INDEX IF NOT EXISTS assets_hash 		 ON Assets (hash) WHERE hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS assets_url 		 ON Assets (discord_url);
CREATE INDEX IF NOT EXISTS assets_uploaded 	 ON Assets (uploaded) WHERE uploaded = 0;
CREATE UNIQUE INDEX IF NOT EXISTS assets_discord_id ON Assets (discord_id);

CREATE TABLE IF NOT EXISTS Guilds (
	id TEXT NOT NULL PRIMARY KEY,
	name TEXT,
	accepted_terms INTEGER NOT NULL DEFAULT 0, -- 1 if the guild has accepted the terms
	asset_id INTEGER,
	-- {{...}} denotes an external macro, see Utils/Database for available macros
	created_at TEXT GENERATED ALWAYS AS ( {{SNOWFLAKE_DATE}} ) VIRTUAL
) STRICT;
CREATE INDEX IF NOT EXISTS guilds_name ON Guilds (name);
CREATE INDEX IF NOT EXISTS guilds_asset_null ON Guilds (asset_id) WHERE asset_id IS NULL;

CREATE TABLE IF NOT EXISTS Channels (
	id TEXT NOT NULL PRIMARY KEY,
	guild_id TEXT NOT NULL,
	parent_id TEXT, -- NULL if no parent
	name TEXT NOT NULL,
	type INTEGER NOT NULL,
	block_exports INTEGER NOT NULL DEFAULT 0, -- 1 if exports are blocked

	created_at TEXT GENERATED ALWAYS AS ( {{SNOWFLAKE_DATE}} ) VIRTUAL,
	last_purge INTEGER NOT NULL DEFAULT ( UNIXEPOCH('now', 'localtime') ) -- Using integer for easy math and quick lookup
) STRICT;
CREATE INDEX IF NOT EXISTS channels_guild_id  ON Channels (guild_id);
CREATE INDEX IF NOT EXISTS channels_parent_id ON Channels (parent_id);
CREATE INDEX IF NOT EXISTS channels_last_purge ON Channels (last_purge DESC);

CREATE TABLE IF NOT EXISTS Users (
	id TEXT NOT NULL PRIMARY KEY,
	username TEXT NOT NULL,
	bot INTEGER NOT NULL DEFAULT 0,
	asset_id INTEGER,
	accepted_terms INTEGER NOT NULL DEFAULT 0, -- 1 if the user has accepted the terms
	created_at TEXT GENERATED ALWAYS AS ( {{SNOWFLAKE_DATE}} ) VIRTUAL
) STRICT;
CREATE INDEX IF NOT EXISTS users_username ON Users (username);
CREATE INDEX IF NOT EXISTS users_asset_null ON Users (asset_id) WHERE asset_id IS NULL;

-- CREATE TABLE IF NOT EXISTS Members (
-- 	user_id TEXT NOT NULL,
-- 	guild_id TEXT NOT NULL,
-- 	joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
-- 	left_at TEXT,
-- 	PRIMARY KEY (user_id, guild_id)
-- );
-- CREATE INDEX IF NOT EXISTS members_guild_id ON Members (guild_id);
-- CREATE INDEX IF NOT EXISTS members_user_id  ON Members (user_id);

CREATE TABLE IF NOT EXISTS Emojis (
	id TEXT NOT NULL PRIMARY KEY,
	name TEXT NOT NULL,
	animated INTEGER NOT NULL DEFAULT 0,
	asset_id INTEGER,
	created_at TEXT GENERATED ALWAYS AS ( {{SNOWFLAKE_DATE}} ) VIRTUAL
) STRICT;
CREATE INDEX IF NOT EXISTS emojis_asset_null ON Emojis (asset_id) WHERE asset_id IS NULL;

CREATE TABLE IF NOT EXISTS Stickers (
	id TEXT NOT NULL PRIMARY KEY,
	name TEXT NOT NULL,
	asset_id INTEGER,
	created_at TEXT GENERATED ALWAYS AS ( {{SNOWFLAKE_DATE}} ) VIRTUAL
) STRICT;
CREATE INDEX IF NOT EXISTS stickers_asset_null ON Stickers (asset_id) WHERE asset_id IS NULL;

CREATE TABLE IF NOT EXISTS Attachments (
	id TEXT NOT NULL PRIMARY KEY,
	message_id TEXT NOT NULL,
	name TEXT NOT NULL,
	asset_id INTEGER,
	created_at TEXT GENERATED ALWAYS AS ( {{SNOWFLAKE_DATE}} ) VIRTUAL
) STRICT;
CREATE INDEX IF NOT EXISTS attachments_message_id ON Attachments (message_id);
CREATE INDEX IF NOT EXISTS attachments_asset_null ON Attachments (asset_id) WHERE asset_id IS NULL;

CREATE TABLE IF NOT EXISTS Embeds (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
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
) STRICT;
CREATE INDEX IF NOT EXISTS embeds_message_id ON Embeds (message_id);

CREATE TABLE IF NOT EXISTS EmbedFields (
	id INTEGER PRIMARY KEY AUTOINCREMENT, -- Only used for ordering, this has no impact on the data
	embed_id INTEGER NOT NULL,
	name TEXT NOT NULL,
	value TEXT NOT NULL,
	inline INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX IF NOT EXISTS embed_fields_embed_id ON EmbedFields (embed_id);

CREATE TABLE IF NOT EXISTS Messages (
	id TEXT NOT NULL PRIMARY KEY,
	guild_id TEXT NOT NULL,
	channel_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	content TEXT,
	sticker_id TEXT,
	reply_to TEXT DEFAULT NULL, -- NULL if no reply, otherwise the message ID of the reply
	created_at TEXT GENERATED ALWAYS AS ( {{SNOWFLAKE_DATE}} ) VIRTUAL
) STRICT;
CREATE INDEX IF NOT EXISTS messages_guild_id   ON Messages (guild_id);
CREATE INDEX IF NOT EXISTS messages_channel_id ON Messages (channel_id);
CREATE INDEX IF NOT EXISTS messages_user_id    ON Messages (user_id);

-- Quick lookup every emoji used in a message
CREATE TABLE IF NOT EXISTS MessageEmojis (
	message_id TEXT NOT NULL,
	emoji_id TEXT NOT NULL,
	count INTEGER NOT NULL,
	PRIMARY KEY (message_id, emoji_id)
) STRICT;
CREATE INDEX IF NOT EXISTS message_emojis_message_id ON MessageEmojis (message_id);
CREATE INDEX IF NOT EXISTS message_emojis_emoji_id   ON MessageEmojis (emoji_id);


CREATE TABLE IF NOT EXISTS Exports (
	id TEXT NOT NULL PRIMARY KEY, -- xxxx-xxxx-xxxx-xxxx
	guild_id TEXT NOT NULL,
	channel_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	message_count INTEGER NOT NULL DEFAULT 0,
	format TEXT NOT NULL,
	hash TEXT NOT NULL UNIQUE, -- The hash of the file
	lookup TEXT NOT NULL UNIQUE, -- The file ID on the CDN server
	created_at TEXT NOT NULL DEFAULT ( strftime('%Y-%m-%dT%H:%M:%fZ', 'now') )
);
CREATE INDEX IF NOT EXISTS exports_user_id ON Exports (user_id);