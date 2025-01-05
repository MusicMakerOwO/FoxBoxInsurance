export enum ExportFormats {
	TEXT = 0,
	JSON = 1,
	HTML = 2,
	CSV = 3
}

export type ExportOptionsConfig = {
	images: boolean; // Attachments, emojis, and stickers
	integrity: boolean; // Check internal hashes to prevent tampering on the host
	bots: boolean;
	largeFiles: boolean; // Larger than 8MB - Depends on `attachments`
}

export interface ExportOptions {
	guildID: string;
	channelID: string;
	maxMessages: number;
	format: ExportFormats;
	timestamp: Date;
	options: ExportOptionsConfig;
}