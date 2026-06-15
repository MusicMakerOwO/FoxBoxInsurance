import {ObjectValues} from "./Typings/HelperTypes";

export const TOS_FEATURES = {
	MESSAGE_EXPORTS: 1,
	SERVER_SNAPSHOTS: 2 ,
	TOS_VERSIONING: 3,
	IMPORT_SNAPSHOTS: 4,
	DATA_COLLECTION_OPT_OUT: 6,
} as const;

type TOS_DATA = {
	date: string,

	added: ObjectValues<typeof TOS_FEATURES>[]
	removed: ObjectValues<typeof TOS_FEATURES>[]

	notes?: string[]
}

export const TOS_VERSIONS: { [key: number]: TOS_DATA } = {
	1: {
		date: '2025 April 25th',
		added: [
			TOS_FEATURES.MESSAGE_EXPORTS
		],
		removed: [],
		notes: ['Initial release of the bot']
	},
	2: {
		date: '2025 May 31st',
		added: [
			TOS_FEATURES.SERVER_SNAPSHOTS,
			TOS_FEATURES.IMPORT_SNAPSHOTS
		],
		removed: [],
		notes: ['Added internal logs for user command usage - never shared or exported']
	},
	3: {
		date: '2026 March 15th',
		added: [
			TOS_FEATURES.TOS_VERSIONING
		],
		removed: [],
		notes: ['This is the last TOS version that is required in all servers']
	},
	4: {
		date: '2026 June 15th',
		added: [
			TOS_FEATURES.DATA_COLLECTION_OPT_OUT
		],
		removed: [],
		notes: ['This TOS version is required by Discord']
	}
} as const;

export const MAX_TOS_VERSION = +Object.keys(TOS_VERSIONS).sort((x, y) => y.localeCompare(x))[0];