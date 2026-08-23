import { PoolConnection } from "mariadb";

// reduced character set to help with confusion, ie O vs 0 or I vs l
const CHARS = 'ABCDEFGHKLMNPQRSTVWXYZ23456789';

/**
 * Generates a random XXXX-XXXX-XXXX-XXXX ID, retrying against `exists` until a collision-free
 * one is found or the attempt budget runs out. Callers own their own uniqueness check since it's
 * scoped to whichever table the ID is a primary key for.
 */
export async function GenerateRandomID(
	connection: PoolConnection,
	exists: (connection: PoolConnection, id: string) => Promise<boolean>,
	attempts = 5
): Promise<string> {
	if (attempts <= 0) throw new Error("Failed to generate ID (out of attempts)");

	// XXXX-XXXX-XXXX-XXXX
	const id: string[] = [];
	for (let i = 0; i < 4; i++) {
		for (let j = 0; j < 4; j++) {
			id.push(CHARS[Math.floor(Math.random() * CHARS.length)]);
		}
		if (i !== 3) id.push('-');
	}
	const idString = id.join('');

	return (await exists(connection, idString))
		? GenerateRandomID(connection, exists, attempts - 1)
		: idString;
}