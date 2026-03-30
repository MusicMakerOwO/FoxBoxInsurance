# SET foreign_key_checks = 0;
#
# DROP TABLE IF EXISTS Timers;
# DROP TABLE IF EXISTS Guilds;
# DROP TABLE IF EXISTS GuildBlocks;
# DROP TABLE IF EXISTS Channels;
# DROP TABLE IF EXISTS Users;
# DROP TABLE IF EXISTS Emojis;
# DROP TABLE IF EXISTS Stickers;
# DROP TABLE IF EXISTS Messages;
# DROP TABLE IF EXISTS Attachments;
# DROP TABLE IF EXISTS Embeds;
# DROP TABLE IF EXISTS EmbedFields;
# DROP TABLE IF EXISTS MessageEmojis;
# DROP TABLE IF EXISTS InteractionLogs;
# DROP TABLE IF EXISTS Snapshots;
# DROP TABLE IF EXISTS SnapshotPermissions;
# DROP TABLE IF EXISTS SnapshotBans;
# DROP TABLE IF EXISTS SnapshotExports;
# DROP TABLE IF EXISTS SnapshotChannels;
# DROP TABLE IF EXISTS SnapshotRoles;
# DROP TABLE IF EXISTS Assets;
# DROP TABLE IF EXISTS Exports;

-- NodeJS can only make timers so long
-- For long-running tasks like channel purging we need a more permanent solution
-- This will keep the run time data even on restart
CREATE TABLE IF NOT EXISTS Timers (
	id VARCHAR(64) NOT NULL PRIMARY KEY,
	last_run BIGINT UNSIGNED NOT NULL DEFAULT 0
);

-- This is a lookup for every single stored asset in the system
-- Things like icons, images, videos, stickers/emojis, etc.
-- If a user or guild has an icon it will show up in here with an ID
CREATE TABLE IF NOT EXISTS Assets (
	discord_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, -- Discord ID of whatever this asset represents
	type TINYINT UNSIGNED NOT NULL,

	-- The URL to the asset on Discord's servers, may return 404 if they delete it
	-- For long term retrieval, use the cdn server and lookup by hash
	discord_url TEXT NOT NULL UNIQUE,

	name VARCHAR(255) NOT NULL, -- File name

	width SMALLINT UNSIGNED,
	height SMALLINT UNSIGNED,
	size INT UNSIGNED, -- in bytes

	hash TEXT -- this will be set after uploading to the cdn server
);

CREATE TABLE IF NOT EXISTS Guilds (
	id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
	name VARCHAR(100) NOT NULL,
	features INT UNSIGNED NOT NULL, -- bitmap of enabled features, see GUILD_FEATURES in ./Types/DatabaseTypes
	last_restore BIGINT UNSIGNED NOT NULL DEFAULT 0 -- The last time the guild was (successfully) restored
);

CREATE TABLE IF NOT EXISTS GuildBlocks (
	guild_id BIGINT UNSIGNED NOT NULL REFERENCES Guilds(id) ON DELETE CASCADE,
	user_id BIGINT UNSIGNED NOT NULL,
	moderator_id BIGINT UNSIGNED, -- NULL if automatic
	PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS guild_blocks_guild_id ON GuildBlocks (guild_id);
CREATE INDEX IF NOT EXISTS guild_blocks_user_id  ON GuildBlocks (user_id);

CREATE TABLE IF NOT EXISTS Channels (
	id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
	guild_id BIGINT UNSIGNED NOT NULL REFERENCES Guilds(id) ON DELETE CASCADE,
	name VARCHAR(100) NOT NULL,
	type TINYINT UNSIGNED NOT NULL,
	block_exports BOOLEAN NOT NULL DEFAULT 0, -- 1 if exports are blocked

	last_purge INT UNSIGNED NOT NULL DEFAULT UNIX_TIMESTAMP() -- The last time the channel was purged
);
CREATE INDEX IF NOT EXISTS channels_guild_id  ON Channels (guild_id);
CREATE INDEX IF NOT EXISTS channels_last_purge ON Channels (last_purge DESC);

CREATE TABLE IF NOT EXISTS Users (
	id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
	username VARCHAR(100) NOT NULL,
	bot BOOLEAN NOT NULL DEFAULT 0,
	terms_version_accepted TINYINT UNSIGNED NOT NULL DEFAULT 0, -- 0 is not accepted
	wrapped_key VARBINARY(512),
    rotation_hour TINYINT UNSIGNED GENERATED ALWAYS AS ( id % 24 ) STORED -- The hour of the day (0-23) the user's key should be rotated
);
CREATE INDEX IF NOT EXISTS users_hour ON Users(rotation_hour ASC);

CREATE TABLE IF NOT EXISTS Emojis (
	id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
	name VARCHAR(32) NOT NULL,
	animated BOOLEAN NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Stickers (
	id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
	name VARCHAR(32) NOT NULL
);

CREATE TABLE IF NOT EXISTS Messages (
    -- metadata IDs
    id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    guild_id BIGINT UNSIGNED NOT NULL REFERENCES Guilds(id),
    channel_id BIGINT UNSIGNED NOT NULL REFERENCES Channels(id),
    user_id BIGINT UNSIGNED NOT NULL REFERENCES Users(id),

    content BLOB, -- either ASCII text or a wrapped key, refer to the encryption version to know which
    sticker_id BIGINT UNSIGNED REFERENCES Stickers(id) ON DELETE SET NULL,
    reply_to BIGINT UNSIGNED DEFAULT NULL, -- NULL if no reply, otherwise the message ID of the reply
    encryption_version TINYINT UNSIGNED DEFAULT NULL, -- future proofing

    -- contains extra data for images, emojis, stickers, and embeds
    -- refer to typings in Typings/DatabaseTypes.ts
    data JSON NOT NULL CHECK (JSON_VALID(data)),

    -- miscellaneous metadata
    length SMALLINT, -- The length of the original message (unencrypted)
    created_at DATETIME GENERATED ALWAYS AS ( FROM_UNIXTIME( ((id >> 22) + 1420070400000) / 1000) ) VIRTUAL -- The time the message was created
);
CREATE INDEX IF NOT EXISTS messages_guild_id   ON Messages (guild_id);
CREATE INDEX IF NOT EXISTS messages_channel_id ON Messages (channel_id);
CREATE INDEX IF NOT EXISTS messages_user_id    ON Messages (user_id);
CREATE INDEX IF NOT EXISTS messages_encryption ON Messages (encryption_version);

CREATE TABLE IF NOT EXISTS Exports (
	id CHAR(19) NOT NULL PRIMARY KEY, -- xxxx-xxxx-xxxx-xxxx
	guild_id BIGINT UNSIGNED NOT NULL,
	channel_id BIGINT UNSIGNED NOT NULL,
	user_id BIGINT UNSIGNED NOT NULL,
	message_count SMALLINT UNSIGNED NOT NULL,
	format VARCHAR(10) NOT NULL,
	hash TEXT NOT NULL UNIQUE, -- The hash of the file
	lookup TEXT NOT NULL UNIQUE, -- The file ID on the CDN server
    created_at INT UNSIGNED NOT NULL DEFAULT UNIX_TIMESTAMP()
);
CREATE INDEX IF NOT EXISTS exports_user_id ON Exports (user_id);

-- No primary key, every single row is a different interaction
CREATE TABLE IF NOT EXISTS InteractionLogs (
	guild_id BIGINT UNSIGNED,
	channel_id BIGINT UNSIGNED,
	user_id BIGINT UNSIGNED NOT NULL,
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
	guild_id BIGINT UNSIGNED NOT NULL REFERENCES Guilds(id) ON DELETE CASCADE,

	type TINYINT UNSIGNED NOT NULL, -- import, automatic, manual, etc.
	pinned BOOLEAN NOT NULL DEFAULT 0, -- 1 if the snapshot is pinned

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP(3) -- 3 decimal places for milliseconds
);
CREATE INDEX IF NOT EXISTS snapshots_guild_id ON Snapshots (guild_id);

CREATE TABLE IF NOT EXISTS SnapshotRoles (
	snapshot_id INT UNSIGNED NOT NULL REFERENCES Snapshots(id) ON DELETE CASCADE,
	deleted BOOLEAN NOT NULL DEFAULT 0, -- 1 if the role was deleted

	id BIGINT UNSIGNED NOT NULL, -- The ID of the role
	name VARCHAR(100) NOT NULL,
	color MEDIUMINT UNSIGNED NOT NULL,
	hoist BOOLEAN NOT NULL, -- 1 if the role is hoisted
	position TINYINT UNSIGNED NOT NULL,
	permissions BIGINT UNSIGNED NOT NULL,
	managed_by BIGINT,

	PRIMARY KEY (snapshot_id, id)
);
CREATE INDEX IF NOT EXISTS snapshot_roleID ON SnapshotRoles (id);


CREATE TABLE IF NOT EXISTS SnapshotChannels (
	snapshot_id INT UNSIGNED NOT NULL REFERENCES Snapshots(id) ON DELETE CASCADE,
	deleted BOOLEAN NOT NULL DEFAULT 0, -- 1 if the channel was deleted

	id BIGINT UNSIGNED NOT NULL,
	type TINYINT UNSIGNED NOT NULL,
	name VARCHAR(100) NOT NULL,
	position TINYINT UNSIGNED NOT NULL,
	topic VARCHAR(4096),
	nsfw BOOLEAN NOT NULL, -- 1 if the channel is NSFW

	parent_id BIGINT UNSIGNED, -- NULL if no parent

    -- refer to typings in Typings/DatabaseTypes.ts
    permission_overwrites JSON NOT NULL CHECK (JSON_VALID(permission_overwrites)),

	PRIMARY KEY (snapshot_id, id)
);
CREATE INDEX IF NOT EXISTS snapshot_channelID ON SnapshotChannels (id);

CREATE TABLE IF NOT EXISTS SnapshotBans (
	snapshot_id INT UNSIGNED NOT NULL REFERENCES Snapshots(id) ON DELETE CASCADE,
	deleted BOOLEAN NOT NULL DEFAULT 0, -- 1 if the user was deleted

	id BIGINT UNSIGNED NOT NULL,
	reason TEXT,

	PRIMARY KEY (snapshot_id, id)
);
CREATE INDEX IF NOT EXISTS snapshot_bans_id ON SnapshotBans (snapshot_id);
CREATE INDEX IF NOT EXISTS snapshot_bans_userID ON SnapshotBans (id);

CREATE TABLE IF NOT EXISTS SnapshotExports (
	id CHAR(19) NOT NULL PRIMARY KEY, -- xxxx-xxxx-xxxx-xxxx

	snapshot_id INT UNSIGNED NOT NULL,
	guild_id BIGINT UNSIGNED NOT NULL,
	user_id BIGINT UNSIGNED NOT NULL,

	length INT UNSIGNED NOT NULL DEFAULT 0, -- The length of the export in bytes
	version INT UNSIGNED NOT NULL DEFAULT 1, -- The version of the export format

	hash TEXT NOT NULL, -- The hash of the file
	algorithm TEXT NOT NULL, -- The algorithm used to encrypt the file
	revoked BOOLEAN NOT NULL DEFAULT 0 -- 1 if the export is revoked
);
CREATE INDEX IF NOT EXISTS snapshot_exports_user_id ON SnapshotExports (user_id);