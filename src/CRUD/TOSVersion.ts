import { MAX_TOS_VERSION, TOS_FEATURES, TOS_VERSIONS } from "../TOSConstants";
import { ObjectValues } from "../Typings/HelperTypes";

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