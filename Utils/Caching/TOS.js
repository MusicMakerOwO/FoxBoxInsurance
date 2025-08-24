const Database = require("../Database");

const guildCache = new Map(); // in-memory cache to avoid database hits
const userCache = new Map();

function CheckType(value, type, name = 'value') {
	if (typeof value !== type) throw new TypeError(`Invalid type for "${name}", expected ${type} but got ${typeof value}`);
}

function ResolveValue(tos) {
	return tos === 1 || tos === true; // 1 = true, 0 = false, undefined = false
}

async function SetGuildTOS(id, value) {
	CheckType(id, 'string', 'id');
	CheckType(value, 'boolean', 'value');
	if (guildCache.get(id) === value) return; // no change, skip update

	guildCache.set(id, value);
	Database.query(`
		UPDATE Guilds
		SET accepted_terms = ?
		WHERE id = ?
	`, [+value, id]);
}

async function GetGuildTOS(id) {
	if (guildCache.has(id)) return guildCache.get(id);

	const { accepted_terms } = (await Database.query(`
		SELECT accepted_terms
		FROM Guilds
		WHERE id = ?
	`, [id]))[0] ?? { accepted_terms: undefined };

	if (accepted_terms === undefined) {
		// If the guild does not exist, initialize it with false
		guildCache.set(id, false);
		return false;
	}

	const value = ResolveValue(accepted_terms);

	guildCache.set(id, value);

	return value;
}

async function SetUserTOS(id, value) {
	CheckType(id, 'string', 'id');
	CheckType(value, 'boolean', 'value');
	if (userCache.get(id) === value) return; // no change, skip update

	userCache.set(id, value);
	Database.query(`
		UPDATE Users
		SET accepted_terms = ?
		WHERE id = ?
	`, [+value, id]);
}

async function GetUserTOS(id) {
	if (userCache.has(id)) return userCache.get(id);

	const { accepted_terms } = (await Database.query(`
		SELECT accepted_terms
		FROM Users
		WHERE id = ?
	`, [id]))[0] ?? { accepted_terms: undefined };

	if (accepted_terms === undefined) {
		// If the user does not exist, initialize it with false
		userCache.set(id, false);
		return false;
	}

	const value = ResolveValue(accepted_terms);

	userCache.set(id, value);

	return value;
}

module.exports = {
	SetGuildTOS,
	GetGuildTOS,

	SetUserTOS,
	GetUserTOS
}