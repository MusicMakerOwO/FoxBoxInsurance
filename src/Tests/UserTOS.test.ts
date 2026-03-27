import { describe, it, expect, vi } from "vitest";
import { SetUserTOSVersion, CanUserAccessTOSFeature } from "../Services/UserTOS";
import { GetUser, SaveUser } from "../CRUD/Users";
import { TOS_FEATURES, MAX_TOS_VERSION } from "../TOSConstants";
import { SimpleUser } from "../Typings/DatabaseTypes";

vi.mock("../CRUD/Users");

const mockUser = (version: number | null): SimpleUser => ({
	id: 1n,
	username: "testuser",
	terms_version_accepted: version,
	// ...other required fields
} as SimpleUser);

describe("SetUserTOSVersion", () => {
	it("sets the user's TOS version if user exists", async () => {
		const user = mockUser(1);
		vi.mocked(GetUser).mockResolvedValueOnce(user);
		vi.mocked(SaveUser).mockResolvedValueOnce(undefined);
		await expect(SetUserTOSVersion(1n, 2)).resolves.toBeUndefined();
		expect(user.terms_version_accepted).toBe(2);
	});

	it("throws if user does not exist", async () => {
		vi.mocked(GetUser).mockResolvedValueOnce(null);
		await expect(SetUserTOSVersion(1n, 2)).rejects.toThrow('User ID does not exist or cannot be accessed');
	});
});

describe("CanUserAccessTOSFeature", () => {
	it("returns false if user has not accepted any TOS version", () => {
		const user = mockUser(null);
		expect(CanUserAccessTOSFeature(user, TOS_FEATURES.MESSAGE_EXPORTS)).toBe(false);
	});

	it("returns true if user accepted a version greater than MAX_TOS_VERSION", () => {
		const user = mockUser(MAX_TOS_VERSION + 1);
		expect(CanUserAccessTOSFeature(user, TOS_FEATURES.MESSAGE_EXPORTS)).toBe(true);
	});

	it("returns true if feature is included in accepted version", async () => {
		const user = mockUser(1);
		vi.doMock("../CRUD/TOSVersion", () => ({
			GetTOSFeatures: () => [TOS_FEATURES.MESSAGE_EXPORTS]
		}));
		const { CanUserAccessTOSFeature } = await import("../Services/UserTOS.js");
		expect(CanUserAccessTOSFeature(user, TOS_FEATURES.MESSAGE_EXPORTS)).toBe(true);
		vi.resetModules();
	});

	it("returns false if feature is not included in accepted version", async () => {
		const user = mockUser(1);
		vi.doMock("../CRUD/TOSVersion", () => ({
			GetTOSFeatures: () => []
		}));
		const { CanUserAccessTOSFeature } = await import("../Services/UserTOS.js");
		expect(CanUserAccessTOSFeature(user, TOS_FEATURES.MESSAGE_EXPORTS)).toBe(false);
		vi.resetModules();
	});

	it("returns false if GetTOSFeatures returns null", async () => {
		const user = mockUser(1);
		vi.doMock("../CRUD/TOSVersion", () => ({
			GetTOSFeatures: () => null
		}));
		const { CanUserAccessTOSFeature } = await import("../Services/UserTOS.js");
		expect(CanUserAccessTOSFeature(user, TOS_FEATURES.MESSAGE_EXPORTS)).toBe(false);
		vi.resetModules();
	});
});