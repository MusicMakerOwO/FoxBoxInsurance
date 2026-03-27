import { AnonymousGuild, Collection, Guild, GuildBan, User } from "discord.js";
import { SECONDS } from "../Constants";
import { TTLCache } from "../DataStructures/TTLCache";

const banCache = new TTLCache<AnonymousGuild['id'], Map<User['id'], GuildBan>>(); // guild_id -> user_id -> GuildBan
export async function FetchAllBans(guild: AnonymousGuild) {
	if (!(guild instanceof Guild)) throw new Error('Expected argument to be a Guild instance');
	if (banCache.has(guild.id)) return banCache.get(guild.id)!;

	const MAX_BANS = 1000;
	const bans = new Map<User['id'], GuildBan>();

	let offset         : User['id'] | null = null;
	let previousOffset : User['id'] | null = null;

	while (true) {
		// @ts-expect-error | key-optional vs value-optional. The code works fine but `after` is key-optional despite the code internally checking value-optional
		const fetchedBans: Collection<string, GuildBan> = await guild.bans.fetch({ limit: MAX_BANS, after: offset });

		if (fetchedBans.size === 0) break; // nothing else to fetch

		for (const [userID, ban] of fetchedBans) {
			bans.set(userID, ban);
		}

		offset = fetchedBans.last()?.user.id ?? null;
		if (!offset || offset === previousOffset) {
			console.warn('Pagination halted: offset is stuck or undefined');
			break;
		}
		previousOffset = offset;

		if (fetchedBans.size < MAX_BANS) break;
	}

	banCache.set(guild.id, bans, SECONDS.HOUR * 1000); // cache for 1 hour
	return bans;
}