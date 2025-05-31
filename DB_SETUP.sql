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
	created_at TEXT NOT NULL DEFAULT ({{ISO_DATE}}), -- The date the asset was created
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
	snapshots_enabled INTEGER NOT NULL DEFAULT 1, -- 1 if the guild has snapshots enabled
	-- {{...}} denotes an external macro, see Utils/Database for available macros
	created_at TEXT GENERATED ALWAYS AS ( {{SNOWFLAKE_DATE}} ) VIRTUAL
) STRICT;
CREATE INDEX IF NOT EXISTS guilds_name ON Guilds (name);
CREATE INDEX IF NOT EXISTS guilds_asset_null ON Guilds (asset_id) WHERE asset_id IS NULL;

CREATE TABLE IF NOT EXISTS GuildBlocks (
	guild_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	moderator_id TEXT, -- NULL if automatic, ie. bot
	created_at TEXT NOT NULL DEFAULT ({{ISO_DATE}}),
	PRIMARY KEY (guild_id, user_id)
) STRICT;
CREATE INDEX IF NOT EXISTS guild_blocks_guild_id ON GuildBlocks (guild_id);
CREATE INDEX IF NOT EXISTS guild_blocks_user_id  ON GuildBlocks (user_id);

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
	created_at TEXT GENERATED ALWAYS AS ( {{SNOWFLAKE_DATE}} ) VIRTUAL,
	key TEXT -- NULL if no key, otherwise the key used to encrypt the user data
) STRICT;
CREATE INDEX IF NOT EXISTS users_username ON Users (username);
CREATE INDEX IF NOT EXISTS users_asset_null ON Users (asset_id) WHERE asset_id IS NULL;

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
	created_at TEXT GENERATED ALWAYS AS ( {{SNOWFLAKE_DATE}} ) VIRTUAL,
	encrypted INTEGER NOT NULL DEFAULT 0, -- 1 if the message is encrypted
	tag TEXT DEFAULT NULL, -- NULL if no tag
	length INTEGER -- The length of the original message (unencrypted)
) STRICT;
CREATE INDEX IF NOT EXISTS messages_guild_id   ON Messages (guild_id);
CREATE INDEX IF NOT EXISTS messages_channel_id ON Messages (channel_id);
CREATE INDEX IF NOT EXISTS messages_user_id    ON Messages (user_id);
CREATE INDEX IF NOT EXISTS messages_encrypted  ON Messages (encrypted) WHERE encrypted = 0;

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
	created_at TEXT NOT NULL DEFAULT ({{ISO_DATE}})
);
CREATE INDEX IF NOT EXISTS exports_user_id ON Exports (user_id);

-- No primary key, every single row is a different interaction
CREATE TABLE IF NOT EXISTS InteractionLogs (
	guild_id TEXT NOT NULL,
	channel_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	type TEXT NOT NULL, -- type of interaction
	name TEXT NOT NULL, -- The name/customID of the component
	created_at TEXT NOT NULL DEFAULT ({{ISO_DATE}})
);
CREATE INDEX IF NOT EXISTS interaction_logs_created_at ON InteractionLogs (created_at ASC);




-- DROP TABLE Snapshots;
-- DROP TABLE SnapshotRoles;
-- DROP TABLE SnapshotChannels;
-- DROP TABLE SnapshotPermissions;
-- DROP TABLE SnapshotBans;

CREATE TABLE IF NOT EXISTS Snapshots (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id TEXT NOT NULL,

	type INTEGER NOT NULL, -- import, automatic, manual, etc.

	-- Deleted just means don't show it in the UI
	-- Need to keep the data for data integrity lol
	deleted INTEGER NOT NULL DEFAULT 0,

	created_at TEXT NOT NULL DEFAULT ({{ISO_DATE}})
) STRICT;
CREATE INDEX IF NOT EXISTS shapshots_guild_id ON Snapshots (guild_id);

CREATE TABLE IF NOT EXISTS SnapshotRoles (
	snapshot_id INTEGER NOT NULL,
	deleted INTEGER NOT NULL DEFAULT 0, -- 1 if the role was deleted

	id TEXT NOT NULL, -- The ID of the role
	name TEXT NOT NULL,
	color INTEGER NOT NULL,
	hoist INTEGER NOT NULL, -- 1 if the role is hoisted
	position INTEGER NOT NULL,
	permissions TEXT NOT NULL,

	hash TEXT NOT NULL, -- The hash of the role

	PRIMARY KEY (snapshot_id, id)
) STRICT;
CREATE INDEX IF NOT EXISTS snapshot_roles_id ON SnapshotRoles (snapshot_id);
CREATE INDEX IF NOT EXISTS snapshot_roleID ON SnapshotRoles (id);


CREATE TABLE IF NOT EXISTS SnapshotChannels (
	snapshot_id INTEGER NOT NULL,
	deleted INTEGER NOT NULL DEFAULT 0, -- 1 if the channel was deleted

	id TEXT NOT NULL,
	type INTEGER NOT NULL,
	name TEXT NOT NULL,
	position INTEGER NOT NULL,
	topic TEXT,
	nsfw INTEGER NOT NULL, -- 1 if the channel is NSFW

	parent_id TEXT, -- NULL if no parent

	hash TEXT NOT NULL, -- The hash of the channel

	PRIMARY KEY (snapshot_id, id)
) STRICT;
CREATE INDEX IF NOT EXISTS snapshot_channels_id ON SnapshotChannels (snapshot_id);
CREATE INDEX IF NOT EXISTS snapshot_channelID ON SnapshotChannels (id);

CREATE TABLE IF NOT EXISTS SnapshotPermissions (
	snapshot_id INTEGER NOT NULL,
	deleted INTEGER NOT NULL DEFAULT 0, -- 1 if the permission was deleted

	channel_id TEXT NOT NULL,
	role_id TEXT NOT NULL,
	id TEXT GENERATED ALWAYS AS (channel_id || '-' || role_id) VIRTUAL, -- The ID of the permission

	-- The permissions of the role in the channel
	allow INTEGER NOT NULL,
	deny INTEGER NOT NULL,

	hash TEXT NOT NULL, -- The hash of the permission

	PRIMARY KEY (snapshot_id, channel_id, role_id)
) STRICT;
CREATE INDEX IF NOT EXISTS snapshot_permissions_id ON SnapshotPermissions (snapshot_id);
CREATE INDEX IF NOT EXISTS snapshot_permissions_channelID ON SnapshotPermissions (channel_id);
CREATE INDEX IF NOT EXISTS snapshot_permissions_roleID ON SnapshotPermissions (role_id);

CREATE TABLE IF NOT EXISTS SnapshotBans (
	snapshot_id INTEGER NOT NULL,
	deleted INTEGER NOT NULL DEFAULT 0, -- 1 if the user was deleted

	user_id TEXT NOT NULL,
	reason TEXT,

	hash TEXT NOT NULL, -- The hash of the ban

	PRIMARY KEY (snapshot_id, user_id)
) STRICT;
CREATE INDEX IF NOT EXISTS snapshot_bans_id ON SnapshotBans (snapshot_id);
CREATE INDEX IF NOT EXISTS snapshot_bans_userID ON SnapshotBans (user_id);