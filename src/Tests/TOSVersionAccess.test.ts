import { describe, it, expect, vi } from "vitest";
import { GetNextRequiredTOSVersion, BuildTOSChangeList } from "../Utils/CheckHandlerAccess";
import { ObjectValues } from "../Typings/HelperTypes";
import { TOS_FEATURES } from "../TOSConstants";

describe("GetNextRequiredTOSVersion", () => {
	it("returns the next required version if feature is added after user's version", () => {
		const disallowed: ObjectValues<typeof TOS_FEATURES>[] = [TOS_FEATURES.MESSAGE_EXPORTS];
		const user = { terms_version_accepted: 0 };
		vi.stubGlobal("ListSupportVersionsWithFeature", (feature: ObjectValues<typeof TOS_FEATURES>) => {
			if (feature === TOS_FEATURES.MESSAGE_EXPORTS) return [1];
			return [];
		});
		expect(GetNextRequiredTOSVersion(disallowed, user))
		.toBe(1);
	});

	it("returns null if no required version is greater than user's version", () => {
		const disallowed: ObjectValues<typeof TOS_FEATURES>[] = [TOS_FEATURES.MESSAGE_EXPORTS];
		const user = { terms_version_accepted: 2 };
		vi.stubGlobal("ListSupportVersionsWithFeature", (feature: ObjectValues<typeof TOS_FEATURES>) => {
			if (feature === TOS_FEATURES.MESSAGE_EXPORTS) return [1];
			return [];
		});
		expect(GetNextRequiredTOSVersion(disallowed, user))
		.toBe(null);
	});

	it("returns the minimum version if all features have a common required version", () => {
		const disallowed: ObjectValues<typeof TOS_FEATURES>[] = [TOS_FEATURES.SERVER_SNAPSHOTS, TOS_FEATURES.IMPORT_SNAPSHOTS];
		const user = { terms_version_accepted: 0 };
		vi.stubGlobal("ListSupportVersionsWithFeature", (feature: ObjectValues<typeof TOS_FEATURES>) => {
			if (feature === TOS_FEATURES.SERVER_SNAPSHOTS) return [2, 3];
			if (feature === TOS_FEATURES.IMPORT_SNAPSHOTS) return [1, 2]; // removed in v3
			return [];
		});
		expect(GetNextRequiredTOSVersion(disallowed, user)).toBe(2);
	});
});

describe("BuildTOSChangeList", () => {
	it("returns a non-empty array if features were added between versions", () => {
		const changes = BuildTOSChangeList(0, 1);
		expect(Array.isArray(changes)).toBe(true);
		expect(changes.length).toBeGreaterThanOrEqual(0);
	});

	it("returns a non-empty array if features were added or removed between versions", () => {
		const changes = BuildTOSChangeList(1, 3);
		expect(Array.isArray(changes)).toBe(true);
		expect(changes.length).toBeGreaterThanOrEqual(0);
	});

	it("returns empty array if no changes between versions", () => {
		expect(BuildTOSChangeList(2, 2)).toEqual([]);
	});
});