import Database from "../Database";
import fs from "fs";
import crypto from "crypto";
import https from "https";

const STORAGE_FOLDER = `${__dirname}/../../../Storage`;
const GUILDS_FOLDER = `${STORAGE_FOLDER}/Guilds`;
const USERS_FOLDER = `${STORAGE_FOLDER}/Users`;
const EMOJIS_FOLDER = `${STORAGE_FOLDER}/Emojis`;
const STICKER_FOLDER = `${STORAGE_FOLDER}/Stickers`;
const ATTACHMENTS_FOLDER = `${STORAGE_FOLDER}/Attachments`;

if (!fs.existsSync(STORAGE_FOLDER)) fs.mkdirSync(STORAGE_FOLDER);

const LOOKUP_DATABASE_FOLDERS: Record<string, string> = {
	'Guilds': GUILDS_FOLDER,
	'Users': USERS_FOLDER,
	'Emojis': EMOJIS_FOLDER,
	'Stickers': STICKER_FOLDER,
	'Attachments': ATTACHMENTS_FOLDER
};

for (const [table, folder] of Object.entries(LOOKUP_DATABASE_FOLDERS)) {
	if (!Database.tables.includes(table)) throw new Error(`Unknown table: ${table}`);
	if (!fs.existsSync(folder)) fs.mkdirSync(folder);
}

const HUNDRED_MEGABYTES = 1024 * 1024 * 100;

/*
CREATE TABLE IF NOT EXISTS Assets (
	asset_id INTEGER PRIMARY KEY AUTOINCREMENT,

	-- Avoid storing duplicates, this is only a lookup for the storage location : [HASH].[EXTENSION]
	url TEXT NOT NULL UNIQUE,
	hash TEXT NOT NULL UNIQUE,
	fileName TEXT ALWAYS AS (hash || '.' || extension) VIRTUAL,

	id TEXT NOT NULL, -- Discord Snowflake
	extension TEXT NOT NULL,

	width INTEGER,
	height INTEGER,
	size INTEGER,
	
	created_at DATETIME GENERATED ALWAYS AS ({{SNOWFLAKE_DATE}}) VIRTUAL
);
*/

const URL_CACHE = new Set<string>();

const QUERY_ExistingAsset = Database.prepare(`
	SELECT url
	FROM Assets
	WHERE url = ?
`);

const QUERY_NewAsset = Database.prepare(`
	INSERT INTO Assets (url, hash, id, extension)
	VALUES (?, ?, ?, ?)
`);

export default async function DownloadAssets(assetsPtr: [table: string, id: string, url: string][]) {

	if (assetsPtr.length === 0) return;

	const assets = Array.from(assetsPtr); // make a full copy and clear the original
	assetsPtr.length = 0;

	console.log(`Downloading ${assets.length} assets...`);

	const start = process.hrtime.bigint();

	// First check each tuple is valid
	for (let i = 0; i < assets.length; i++) {
		const [table, _, url] = assets[i];

		if (!Database.tables.includes(table)) {
			console.error(`Unknown table: ${table}`);
			continue;
		}

		if (URL_CACHE.has(url)) continue;

		const existing = QUERY_ExistingAsset.get(url);
		if (existing) {
			// We already have this asset, no need to download it again
			URL_CACHE.add(url);
			continue;
		}

		// Now download the file
		const data = await DownloadFile(url);
		const hash = crypto.createHash('md5').update(data).digest('hex');
		const ext = url.split('.').pop()!.split('?')[0];
		try {
			QUERY_NewAsset.run(url, hash, assets[i][1], ext);
			URL_CACHE.add(url);
		} catch (error) {
			console.error(`Failed to download asset: ${url}`);
			console.error('Data:', data.subarray(0, 100).toString());
			console.error('Hash:', hash);
			console.error(error);
		}

		if (data.length > HUNDRED_MEGABYTES) {
			console.log(`Skipping asset download: ${url} (${CleanSize(data.length)})`);
			continue;
		}

		const folder = LOOKUP_DATABASE_FOLDERS[table];

		const filename = `${folder}/${hash}.${ext}`;
		try {
			await fs.promises.writeFile(filename, data);
		} catch (error) {
			console.error(`Failed to write asset to disk: ${filename}`);
			console.error(error);
		}
	}

	const end = process.hrtime.bigint();
	console.log(`Downloaded ${assets.length} assets in ${Number(end - start) / 1e9} seconds`);
}

const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
function CleanSize(bytes: number) {
	let i = 0;
	while (bytes >= 1024) {
		bytes >>= 10;
		i++;
	}
	return `${bytes} ${sizes[i]}`;
}


async function DownloadFile(url: string) : Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const req = https.get(url, res => {
			const data: Buffer[] = [];
			res.on('data', data.push.bind(data));
			res.on('end', () => resolve(Buffer.concat(data)));
		});
		req.on('error', error => reject(error));
		req.on('timeout', () => reject(new Error('Request timed out')));
	});
}