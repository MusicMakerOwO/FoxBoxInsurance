import { GetUser, SaveUser } from "../CRUD/Users";
import { SimpleUser } from "../Typings/DatabaseTypes";
import { MAX_TOS_VERSION, TOS_FEATURES } from "../TOSConstants";
import { ObjectValues } from "../Typings/HelperTypes";
import { GetTOSFeatures } from "../CRUD/TOSVersion";

/** Mutates the data in place and then saves it to the database in the background */
export async function SetUserTOSVersion(id: string | bigint, version: number) {
	id = BigInt(id);
	const saved = await GetUser(id); // internally it just saves the guild if it doesn't exist, great to ensure the data truly exists
	if (saved === null) throw new Error('User ID does not exist or cannot be accessed');
	saved.terms_version_accepted = version;
	void SaveUser(saved);
}

export function CanUserAccessTOSFeature(user: SimpleUser, feature: ObjectValues<typeof TOS_FEATURES>): boolean {
	if (user.terms_version_accepted === 0) return false;
	if (user.terms_version_accepted > MAX_TOS_VERSION) return true; // if they accepted a tos version that doesn't exist, assume they accepted the latest one

	const features = GetTOSFeatures(user.terms_version_accepted) ?? [];
	return features.includes(feature);
}