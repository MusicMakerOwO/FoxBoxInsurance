import { GetUser, SaveUser } from "../CRUD/Users.js";
import { SimpleUser } from "../Typings/DatabaseTypes.js";
import { MAX_TOS_VERSION, TOS_FEATURES } from "../TOSConstants.js";
import { ObjectValues } from "../Typings/HelperTypes.js";
import { GetTOSFeatures } from "../CRUD/TOSVersion.js";

/** Mutates the data in place and saves it to the database */
export async function SetUserTOSVersion(id: string | bigint, version: number): Promise<void> {
	id = BigInt(id);
	const saved = await GetUser(id); // internally it just saves the user if it doesn't exist, great to ensure the data truly exists
	if (!saved) throw new Error('User ID does not exist or cannot be accessed');
	saved.terms_version_accepted = version;
	await SaveUser(saved);
}

export function CanUserAccessTOSFeature(user: SimpleUser, feature: ObjectValues<typeof TOS_FEATURES>): boolean {
	if (user.terms_version_accepted === 0) return false;
	if (user.terms_version_accepted > MAX_TOS_VERSION) return true; // if they accepted a tos version that doesn't exist, assume they accepted the latest one

	const features = GetTOSFeatures(user.terms_version_accepted) ?? [];
	return features.includes(feature);
}