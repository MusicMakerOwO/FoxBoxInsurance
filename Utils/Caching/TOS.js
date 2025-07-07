const Database = require("../Database");

const guildCache = new Map(); // in-memory cache to avoid database hits
const userCache = new Map();

function CheckType(value, type, name = 'value') {
	if (typeof value !== type) throw new TypeError(`Invalid type for "${name}", expected ${type} but got ${typeof value}`);
}

function ResolveValue(tos) {
	return tos === 1 || tos === true; // 1 = true, 0 = false, undefined = false
}

function SetGuildTOS(id, value) {
	CheckType(id, 'string', 'id');
	CheckType(value, 'boolean', 'value');
	if (guildCache.get(id) === value) return; // no change, skip update

	guildCache.set(id, value);
	Database.prepare(`
		UPDATE guilds
		SET tos = ?
		WHERE id = ?
	`).run(+value, id);
}

function GetGuildTOS(id) {
	if (guildCache.has(id)) return guildCache.get(id);

	const tos = Database.prepare(`
		SELECT accepted_terms
		FROM guilds
		WHERE id = ?
	`).pluck().get(id);

	if (tos === undefined) {
		// If the guild does not exist, initialize it with false
		guildCache.set(id, false);
		return false;
	}

	const value = ResolveValue(tos);

	guildCache.set(id, value);

	return value;
}

function SetUserTOS(id, value) {
	CheckType(id, 'string', 'id');
	CheckType(value, 'boolean', 'value');
	if (userCache.get(id) === value) return; // no change, skip update

	userCache.set(id, value);
	Database.prepare(`
		UPDATE users
		SET accepted_terms = ?
		WHERE id = ?
	`).run(+value, id);
}

function GetUserTOS(id) {
	if (userCache.has(id)) return userCache.get(id);

	const tos = Database.prepare(`
		SELECT accepted_terms
		FROM users
		WHERE id = ?
	`).pluck().get(id);

	if (tos === undefined) {
		// If the user does not exist, initialize it with false
		userCache.set(id, false);
		return false;
	}

	const value = ResolveValue(tos);

	userCache.set(id, value);

	return value;
}

module.exports = {
	SetGuildTOS,
	GetGuildTOS,

	SetUserTOS,
	GetUserTOS
}