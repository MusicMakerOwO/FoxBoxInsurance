-- NodeJS can only make timers so long
-- For long running tasks like channel purging we need a more permanent solution
-- This will keep the run time data even on restart
CREATE TABLE IF NOT EXISTS Timers (
	id VARCHAR(64) NOT NULL PRIMARY KEY,
	last_run BIGINT UNSIGNED NOT NULL DEFAULT 0
);

-- This is a lookup for every single stored asset in the system
-- Things like icons, images, videos, stickers/emojis, etc
-- If a user or guild has an icon it will show up in here with an ID
CREATE TABLE IF NOT EXISTS Assets (
	asset_id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
	discord_id VARCHAR(20) NOT NULL UNIQUE, -- Discord ID of whatever this asset represents
	type TINYINT UNSIGNED NOT NULL,

	-- The URL to the asset on Discord's servers, may return 404 if they delete it
	-- For long term retrieval, use the cdn server and lookup by hash
	discord_url TEXT NOT NULL UNIQUE,

	name VARCHAR(255) NOT NULL, -- Original file name
	extension VARCHAR(255) NOT NULL,
	fileName VARCHAR(512) GENERATED ALWAYS AS ( CONCAT(name, '.', extension) ) VIRTUAL, -- The file name of the asset

	width SMALLINT UNSIGNED,
	height SMALLINT UNSIGNED,
	size INT UNSIGNED, -- in bytes

	hash TEXT, -- this will be set after uploading to the cdn server
	uploaded BOOLEAN NOT NULL DEFAULT 0 -- 1 if the asset has been uploaded to the cdn server
);
CREATE INDEX IF NOT EXISTS assets_hash 		 ON Assets (hash);
CREATE INDEX IF NOT EXISTS assets_url 		 ON Assets (discord_url);
CREATE INDEX IF NOT EXISTS assets_uploaded 	 ON Assets (uploaded ASC);

CREATE TABLE IF NOT EXISTS Guilds (
	id VARCHAR(20) NOT NULL PRIMARY KEY,
	name VARCHAR(100) NOT NULL,
	accepted_terms BOOLEAN NOT NULL DEFAULT 0, -- 1 if the guild has accepted the terms
	asset_id INT UNSIGNED, -- NULL if no icon
	snapshots_enabled BOOLEAN NOT NULL DEFAULT 1, -- 1 if the guild has snapshots enabled
	last_restore BIGINT UNSIGNED NOT NULL DEFAULT 0 -- The last time the guild was (successfully) restored
);
CREATE INDEX IF NOT EXISTS guilds_name ON Guilds (name);
CREATE INDEX IF NOT EXISTS guilds_asset ON Guilds (asset_id);

CREATE TABLE IF NOT EXISTS GuildBlocks (
	guild_id VARCHAR(20) NOT NULL,
	user_id VARCHAR(20) NOT NULL,
	moderator_id VARCHAR(20), -- NULL if automatic
	PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS guild_blocks_guild_id ON GuildBlocks (guild_id);
CREATE INDEX IF NOT EXISTS guild_blocks_user_id  ON GuildBlocks (user_id);

CREATE TABLE IF NOT EXISTS Channels (
	id VARCHAR(20) NOT NULL PRIMARY KEY,
	guild_id VARCHAR(20) NOT NULL,
	parent_id VARCHAR(20), -- NULL if no parent
	name VARCHAR(100) NOT NULL,
	type TINYINT UNSIGNED NOT NULL,
	block_exports BOOLEAN NOT NULL DEFAULT 0, -- 1 if exports are blocked

	last_purge INT UNSIGNED NOT NULL DEFAULT UNIX_TIMESTAMP() -- The last time the channel was purged
);
CREATE INDEX IF NOT EXISTS channels_guild_id  ON Channels (guild_id);
CREATE INDEX IF NOT EXISTS channels_parent_id ON Channels (parent_id);
CREATE INDEX IF NOT EXISTS channels_last_purge ON Channels (last_purge DESC);

CREATE TABLE IF NOT EXISTS Users (
	id VARCHAR(20) NOT NULL PRIMARY KEY,
	username VARCHAR(100) NOT NULL,
	bot BOOLEAN NOT NULL DEFAULT 0,
	asset_id INT UNSIGNED, -- NULL if no avatar
	accepted_terms BOOLEAN NOT NULL DEFAULT 0, -- 1 if the user has accepted the terms
	wrapped_key VARBINARY(512) -- NULL if no key, otherwise the key used to encrypt the user data
);
CREATE INDEX IF NOT EXISTS users_username ON Users (username);
CREATE INDEX IF NOT EXISTS users_asset ON Users (asset_id ASC);

CREATE TABLE IF NOT EXISTS Emojis (
	id VARCHAR(20) NOT NULL PRIMARY KEY,
	name VARCHAR(32) NOT NULL,
	animated BOOLEAN NOT NULL DEFAULT 0,
	asset_id INT UNSIGNED
);
CREATE INDEX IF NOT EXISTS emojis_asset_null ON Emojis (asset_id);

CREATE TABLE IF NOT EXISTS Stickers (
	id VARCHAR(20) NOT NULL PRIMARY KEY,
	name VARCHAR(32) NOT NULL,
	asset_id INT UNSIGNED
);
CREATE INDEX IF NOT EXISTS stickers_asset_null ON Stickers (asset_id);

CREATE TABLE IF NOT EXISTS Attachments (
	id VARCHAR(20) NOT NULL PRIMARY KEY,
	message_id VARCHAR(20) NOT NULL,
	name TEXT NOT NULL,
	asset_id INT UNSIGNED
);
CREATE INDEX IF NOT EXISTS attachments_message_id ON Attachments (message_id);
CREATE INDEX IF NOT EXISTS attachments_asset_null ON Attachments (asset_id);

CREATE TABLE IF NOT EXISTS Embeds (
	id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
	message_id VARCHAR(20) NOT NULL,
	title VARCHAR(256),
	description VARCHAR(4096),
	url TEXT,
	timestamp TEXT,
	color MEDIUMINT UNSIGNED, -- 3 byes; RGB
	footer_text VARCHAR(2048),
	footer_icon TEXT,
	thumbnail_url TEXT,
	image_url TEXT,
	author_name VARCHAR(256),
	author_url TEXT,
	author_icon TEXT
);
CREATE INDEX IF NOT EXISTS embeds_message_id ON Embeds (message_id);

CREATE TABLE IF NOT EXISTS EmbedFields (
	id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT, -- Only used for ordering, this has no impact on the data
	embed_id INT UNSIGNED NOT NULL,
	name VARCHAR(256) NOT NULL,
	value VARCHAR(1024) NOT NULL,
	inline BOOLEAN NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS embed_fields_embed_id ON EmbedFields (embed_id);

CREATE TABLE IF NOT EXISTS Messages (
	-- metadata IDs
    id VARCHAR(20) NOT NULL PRIMARY KEY,
	guild_id VARCHAR(20) NOT NULL,
	channel_id VARCHAR(20) NOT NULL,
	user_id VARCHAR(20) NOT NULL,

    -- message content
	content BLOB,
	sticker_id VARCHAR(20),
	reply_to VARCHAR(20) DEFAULT NULL, -- NULL if no reply, otherwise the message ID of the reply

    -- encryption details
	encrypted BOOLEAN NOT NULL DEFAULT 0, -- 1 if the message is encrypted
    iv VARBINARY(12) DEFAULT NULL,
    tag VARBINARY(16) DEFAULT NULL,
    wrapped_dek BIGINT UNSIGNED DEFAULT NULL REFERENCES UserKeys(id),
    encryption_version TINYINT UNSIGNED DEFAULT NULL, -- future proofing

    -- miscellaneous metadata
	length SMALLINT, -- The length of the original message (unencrypted)
    created_at DATETIME GENERATED ALWAYS AS ( FROM_UNIXTIME(SUBSTRING(id, 1, 10) + 1420070400) ) VIRTUAL -- The time the message was created
);
CREATE INDEX IF NOT EXISTS messages_guild_id   ON Messages (guild_id);
CREATE INDEX IF NOT EXISTS messages_channel_id ON Messages (channel_id);
CREATE INDEX IF NOT EXISTS messages_user_id    ON Messages (user_id);
CREATE INDEX IF NOT EXISTS messages_encrypted  ON Messages (encrypted ASC);

-- Quick lookup every emoji used in a message
CREATE TABLE IF NOT EXISTS MessageEmojis (
	message_id VARCHAR(20) NOT NULL,
	emoji_id VARCHAR(20) NOT NULL,
    -- the largest message can have 4,000 messages
    -- the smallest emoji is 24 bytes: <:aa:12345678901234567:>
    -- 4000 / 24 = 170 max emojis in a message
	count TINYINT UNSIGNED NOT NULL,
	PRIMARY KEY (message_id, emoji_id)
);
CREATE INDEX IF NOT EXISTS message_emojis_message_id ON MessageEmojis (message_id);
CREATE INDEX IF NOT EXISTS message_emojis_emoji_id   ON MessageEmojis (emoji_id);


CREATE TABLE IF NOT EXISTS Exports (
	id CHAR(19) NOT NULL PRIMARY KEY, -- xxxx-xxxx-xxxx-xxxx
	guild_id VARCHAR(20) NOT NULL,
	channel_id VARCHAR(20) NOT NULL,
	user_id VARCHAR(20) NOT NULL,
	message_count SMALLINT UNSIGNED NOT NULL,
	format VARCHAR(10) NOT NULL,
	hash TEXT NOT NULL UNIQUE, -- The hash of the file
	lookup TEXT NOT NULL UNIQUE -- The file ID on the CDN server
);
CREATE INDEX IF NOT EXISTS exports_user_id ON Exports (user_id);

-- No primary key, every single row is a different interaction
CREATE TABLE IF NOT EXISTS InteractionLogs (
	guild_id VARCHAR(20),
	channel_id VARCHAR(20),
	user_id VARCHAR(20) NOT NULL,
	type TINYTEXT NOT NULL, -- type of interaction
	name TINYTEXT NOT NULL, -- The name/customID of the component
    created_at INT UNSIGNED NOT NULL DEFAULT UNIX_TIMESTAMP()
);
CREATE INDEX IF NOT EXISTS interaction_logs_created_at ON InteractionLogs (created_at ASC);




-- DROP TABLE Snapshots;
-- DROP TABLE SnapshotRoles;
-- DROP TABLE SnapshotChannels;
-- DROP TABLE SnapshotPermissions;
-- DROP TABLE SnapshotBans;

CREATE TABLE IF NOT EXISTS Snapshots (
	id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
	guild_id VARCHAR(20) NOT NULL,

	type TINYINT UNSIGNED NOT NULL, -- import, automatic, manual, etc.
	pinned BOOLEAN NOT NULL DEFAULT 0, -- 1 if the snapshot is pinned

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP(3) -- 3 decimal places for milliseconds
);
CREATE INDEX IF NOT EXISTS snapshots_guild_id ON Snapshots (guild_id);

CREATE TABLE IF NOT EXISTS SnapshotRoles (
	snapshot_id INT UNSIGNED NOT NULL,
	deleted BOOLEAN NOT NULL DEFAULT 0, -- 1 if the role was deleted

	id VARCHAR(20) NOT NULL, -- The ID of the role
	name VARCHAR(100) NOT NULL,
	color MEDIUMINT UNSIGNED NOT NULL,
	hoist BOOLEAN NOT NULL, -- 1 if the role is hoisted
	position TINYINT UNSIGNED NOT NULL,
	permissions TINYTEXT NOT NULL,
	managed BOOLEAN NOT NULL DEFAULT 0, -- 1 if the role is managed by an integration

	needsUpdate BOOLEAN NOT NULL DEFAULT 0, -- 1 if the hash needs to be updated
	hash TEXT NOT NULL, -- The hash of the role

	PRIMARY KEY (snapshot_id, id)
);
CREATE INDEX IF NOT EXISTS snapshot_roles_id ON SnapshotRoles (snapshot_id);
CREATE INDEX IF NOT EXISTS snapshot_roleID ON SnapshotRoles (id);
CREATE INDEX IF NOT EXISTS snapshot_roles_update ON SnapshotRoles (needsUpdate);


CREATE TABLE IF NOT EXISTS SnapshotChannels (
	snapshot_id INT UNSIGNED NOT NULL,
	deleted BOOLEAN NOT NULL DEFAULT 0, -- 1 if the channel was deleted

	id VARCHAR(20) NOT NULL,
	type TINYINT UNSIGNED NOT NULL,
	name VARCHAR(100) NOT NULL,
	position TINYINT UNSIGNED NOT NULL,
	topic VARCHAR(4096),
	nsfw BOOLEAN NOT NULL, -- 1 if the channel is NSFW

	parent_id VARCHAR(20), -- NULL if no parent

	needsUpdate BOOLEAN NOT NULL DEFAULT 0, -- 1 if the hash needs to be updated
	hash TEXT NOT NULL, -- The hash of the channel

	PRIMARY KEY (snapshot_id, id)
);
CREATE INDEX IF NOT EXISTS snapshot_channels_id ON SnapshotChannels (snapshot_id);
CREATE INDEX IF NOT EXISTS snapshot_channelID ON SnapshotChannels (id);
CREATE INDEX IF NOT EXISTS snapshot_channels_update ON SnapshotChannels (needsUpdate);

CREATE TABLE IF NOT EXISTS SnapshotPermissions (
	snapshot_id INT UNSIGNED NOT NULL,
	deleted BOOLEAN NOT NULL DEFAULT 0, -- 1 if the permission was deleted

	channel_id VARCHAR(20) NOT NULL,
	role_id VARCHAR(20) NOT NULL,
	id TEXT GENERATED ALWAYS AS ( CONCAT(channel_id || '-' || role_id) ) VIRTUAL, -- The ID of the permission

	-- The permissions of the role in the channel
	allow BIGINT UNSIGNED NOT NULL,
	deny BIGINT UNSIGNED NOT NULL,

	needsUpdate BOOLEAN NOT NULL DEFAULT 0, -- 1 if the hash needs to be updated
	hash TEXT NOT NULL, -- The hash of the permission

	PRIMARY KEY (snapshot_id, channel_id, role_id)
);
CREATE INDEX IF NOT EXISTS snapshot_permissions_id ON SnapshotPermissions (snapshot_id);
CREATE INDEX IF NOT EXISTS snapshot_permissions_channelID ON SnapshotPermissions (channel_id);
CREATE INDEX IF NOT EXISTS snapshot_permissions_roleID ON SnapshotPermissions (role_id);
CREATE INDEX IF NOT EXISTS snapshot_permissions_update ON SnapshotPermissions (needsUpdate);

CREATE TABLE IF NOT EXISTS SnapshotBans (
	snapshot_id INT UNSIGNED NOT NULL,
	deleted BOOLEAN NOT NULL DEFAULT 0, -- 1 if the user was deleted

	user_id VARCHAR(20) NOT NULL,
	reason TEXT,

	hash TEXT NOT NULL, -- The hash of the ban

	PRIMARY KEY (snapshot_id, user_id)
);
CREATE INDEX IF NOT EXISTS snapshot_bans_id ON SnapshotBans (snapshot_id);
CREATE INDEX IF NOT EXISTS snapshot_bans_userID ON SnapshotBans (user_id);

CREATE TABLE IF NOT EXISTS SnapshotExports (
	id CHAR(19) NOT NULL PRIMARY KEY, -- xxxx-xxxx-xxxx-xxxx

	snapshot_id INT UNSIGNED NOT NULL,
	guild_id VARCHAR(20) NOT NULL,
	user_id VARCHAR(20) NOT NULL,

	length INT UNSIGNED NOT NULL DEFAULT 0, -- The length of the export in bytes
	version INT UNSIGNED NOT NULL DEFAULT 1, -- The version of the export format

	hash TEXT NOT NULL, -- The hash of the file
	algorithm TEXT NOT NULL, -- The algorithm used to encrypt the file
	revoked BOOLEAN NOT NULL DEFAULT 0 -- 1 if the export is revoked
);
CREATE INDEX IF NOT EXISTS snapshot_exports_user_id ON SnapshotExports (user_id);