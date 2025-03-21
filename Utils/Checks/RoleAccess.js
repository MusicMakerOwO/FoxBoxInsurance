module.exports = function MemberAccess(requiredRoles, member) {
	if (!member) throw ['You don\'t have permission to use this command!', 'Missing member, are they in a guild?'];
	if (!(member instanceof GuildMember)) throw ['You don\'t have permission to use this command!', 'Member is not a GuildMember'];
	if (!requiredRoles.length) return;
	if (member.permissions.has('Administrator')) return; // Admins can do anything

	// const hasRole = requiredRoles.some(Array.prototype.includes.bind(member._roles));
	let hasRole = false;
	for (let i = 0; i < requiredRoles.length; i++) {
		for (let j = 0, role = member._roles[j]; j < member._roles.length; j++) {
			if (role === requiredRoles[i]) {
				hasRole = true;
				break;
			}
		}
	}
	if (!hasRole) throw ['You don\'t have permission to use this command!', 'Missing roles'];
};