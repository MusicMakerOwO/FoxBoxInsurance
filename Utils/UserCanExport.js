const { GuildMember } = require("discord.js");
const Database = require("./Database");

module.exports = function CanUserExportChannel(member, channelID) {
	if (!(member instanceof GuildMember)) throw new Error('First argument must be a GuildMember');
	if (typeof channelID !== 'string') throw new TypeError('Second argument must be a string');

	// admins bypass everything lol
	const isAdmin = member.permissions.has('Administrator');
	if (isAdmin) return true;
	
	// admin disabled the specific channel
	const isDisabled = Database.prepare("SELECT block_exports FROM Channels WHERE id = ?").pluck().get(channelID);
	if (isDisabled) return false;
	
	// banned users are blocked from using exports
	const isBlocked = Database.prepare("SELECT user_id FROM GuildBlocks WHERE guild_id = ? AND user_id = ?").pluck().get(member.guild.id, channelID);
	if (isBlocked) return false;

	return true;
}