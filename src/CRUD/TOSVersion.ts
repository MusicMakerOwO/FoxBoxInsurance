import { MAX_TOS_VERSION, TOS_FEATURES, TOS_VERSIONS } from "../TOSConstants";
import { ObjectValues } from "../Typings/HelperTypes";
import { SimpleUser } from "../Typings/DatabaseTypes";

export const TOS_FEATURE_DESCRIPTION: { [K in ObjectValues<typeof TOS_FEATURES>]: Lowercase<string> } = {
	[TOS_FEATURES.MESSAGE_EXPORTS] : 'message exports',
	[TOS_FEATURES.SERVER_SNAPSHOTS]: 'server snapshots',
	[TOS_FEATURES.IMPORT_SNAPSHOTS]: 'snapshot imports',
	[TOS_FEATURES.TOS_VERSIONING]  : 'tos versioning',
} as const;

// Precompute features table for O(1) lookup
const FEATURES_TABLE = new Array<ObjectValues<typeof TOS_FEATURES>[]>(MAX_TOS_VERSION - 1); // first version = 1

const features = new Set<ObjectValues<typeof TOS_FEATURES>>();
for (let i = 0; i < MAX_TOS_VERSION; i++) {
	const tos = TOS_VERSIONS[i + 1]!;
	for (const feature of tos.added) features.add(feature);
	for (const feature of tos.removed) features.delete(feature);
	FEATURES_TABLE[i] = Array.from(features);
}

export function GetTOSFeatures(version: number): ObjectValues<typeof TOS_FEATURES>[] | null {
	if (!version || version <= 0 || version > MAX_TOS_VERSION) return null;
	return FEATURES_TABLE[version - 1];
}

export function ListSupportVersionsWithFeature(feature: ObjectValues<typeof TOS_FEATURES>): number[] {
	const supportedVersions: number[] = [];
	for (let version = 1; version < MAX_TOS_VERSION; version++) {
		const features = FEATURES_TABLE[version];
		if (features && features.includes(feature)) {
			supportedVersions.push(version);
		}
	}
	return supportedVersions;
}

/**
 * Determines the next required TOS version for the user based on required features
 * @returns The next required TOS version number, or null if not found.
 */
export function GetNextRequiredTOSVersion(
	requiredFeatures: ObjectValues<typeof TOS_FEATURES>[],
	user: Pick<SimpleUser, 'terms_version_accepted'>,

	/** ONLY FOR USE IN TESTING */
	ListSupportVersionsWithFeatureImpl?: (feature: ObjectValues<typeof TOS_FEATURES>) => number[]
): number | null {
	const ListSupport = ListSupportVersionsWithFeatureImpl ?? ListSupportVersionsWithFeature;
	if (!requiredFeatures.length) return null;
	const versionSets = requiredFeatures.map(feature =>
		ListSupport(feature).filter(v => v > user.terms_version_accepted)
	);
	if (versionSets.some(set => set.length === 0)) return null;
	const intersection = versionSets.reduce((a, b) => a.filter(v => b.includes(v)));
	if (!intersection.length) return null;

	return Math.min(...intersection);
}

/** Builds a changelist of TOS features added/removed between two TOS versions */
export function BuildTOSChangeList(fromVersion: number, toVersion: number): string[] {
	const changes: string[] = [];
	const seen = new Set<number>();
	for (let v = fromVersion + 1; v <= toVersion; v++) {
		const tosData = TOS_VERSIONS[v];
		if (!tosData) continue;
		for (const feature of tosData.added) {
			if (!seen.has(feature)) {
				changes.push(`Added ${TOS_FEATURE_DESCRIPTION[feature]}`);
				seen.add(feature);
			}
		}
		for (const feature of tosData.removed) {
			if (seen.has(feature)) {
				changes.push(`Removed ${TOS_FEATURE_DESCRIPTION[feature]}`);
				seen.delete(feature);
			}
		}
	}
	return changes;
}