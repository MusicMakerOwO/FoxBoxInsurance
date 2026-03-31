import { ObjectValues } from "../../Typings/HelperTypes";
import LimitedSet from "../DataStructures/LimitedSet";
import { Log } from "../Log";
import fs, { unlinkSync } from "node:fs";
import { TestConnection } from "../TestConnection";
import { DOWNLOAD_CACHE_PATH, UPLOAD_CACHE_PATH } from "../Constants";
import { Database } from "../../Database";
import https from "node:https";
import { Asset } from "../../Typings/DatabaseTypes";

const HUNDRED_MEGABYTES = 1024 * 1024 * 100;

export const ASSET_TYPE = {
	GUILD     : 0,
	USER      : 1,
	EMOJI     : 2,
	STICKER   : 3,
	ATTACHMENT: 4
} as const;

export type BasicAsset = {
	/** Discord ID wherever this asset is generated from */
	id: string;
	type: ObjectValues<typeof ASSET_TYPE>;

	name: string;
	url: string;

	width: number | null;
	height: number | null;
}

const RecentURLs = new LimitedSet<BasicAsset['url']>(1000);
const DownloadObjects = new Map<BasicAsset['id'], BasicAsset>();

let timeout: NodeJS.Timeout | undefined;

export function QueueDownload(asset: BasicAsset) {
	if (RecentURLs.has(asset.url)) return;

	// using a map because if someone updates their profile picture
	// then it would make sense to discard the old icon and download
	// the new one instead
	DownloadObjects.set(asset.id, asset);

	if (!timeout) {
		timeout = setTimeout(DownloadAssets, 5000);
	}
}

function LoadFailedDownloads() {
	const failedAssets: BasicAsset[] = [];

	if (!fs.existsSync(DOWNLOAD_CACHE_PATH)) fs.mkdirSync(DOWNLOAD_CACHE_PATH);
	const cacheFiles = fs.readdirSync(DOWNLOAD_CACHE_PATH)
	.filter(file => file.endsWith('.json'));
	for (const file of cacheFiles) {
		const filePath = `${DOWNLOAD_CACHE_PATH}/${file}`;
		try {
			const contents = fs.readFileSync(filePath, 'utf-8');
			const data = JSON.parse(contents) as BasicAsset[];
			if (!Array.isArray(data)) {
				Log('ERROR', `Invalid cache file format: ${file}`);
				continue;
			}

			if (data.length === 0) {
				unlinkSync(filePath); // delete empty cache file
				continue;
			}

			Log('DEBUG', `Retrying failed downloads from cache: ${file}`);
			failedAssets.push(... data); // add failed downloads back to the queue
			unlinkSync(filePath); // delete the cache file after re-adding to queue
		} catch (err) {
			Log('ERROR', err);
		}
	}

	return failedAssets;
}

/**
 * Tracks the currently-running DownloadAssets promise so that a second caller
 * (e.g. the shutdown handler) awaits the same in-flight work instead of
 * seeing an empty queue and returning immediately.
 */
let activeDownload: Promise<void> | undefined;

export function DownloadAssets(): Promise<void> {
	// If a download run is already in progress (started by the scheduled
	// timeout), return the same promise instead of starting a second run
	// that would see an empty queue and return immediately.
	if (activeDownload) return activeDownload;

	activeDownload = _runDownloadAssets().finally(() => {
		activeDownload = undefined;
	});

	return activeDownload;
}

async function _runDownloadAssets() {
	clearTimeout(timeout);
	timeout = undefined;

	// check the download cache folder for failed downloads
	const failedAssets = LoadFailedDownloads();
	for (const asset of failedAssets) {
		if (!DownloadObjects.has(asset.id)) DownloadObjects.set(asset.id, asset);
	}

	if (DownloadObjects.size === 0) return; // nothing to download

	// copy the queue to a local variable and clear the public one
	const queue = Array.from(DownloadObjects.values());
	DownloadObjects.clear();

	Log('DEBUG', `Downloading ${queue.length} assets`);

	let cacheHit = 0;

	const failedDownloads: BasicAsset[] = [];
	let noInternet = !await TestConnection();
	if (noInternet) {
		Log('ERROR', `No internet connection, cannot download assets`);
	}

	const queuedAssets: Omit<Asset, 'hash'>[] = [];

	const start = Date.now();
	for (const asset of queue) {
		// assume duplicate asset, each url *should* be unique unless I am forgetting something
		if (RecentURLs.has(asset.url)) {
			cacheHit++;
			continue;
		}
		RecentURLs.add(asset.url);

		if (noInternet) {
			// if we already had a failure, stop trying to download
			failedDownloads.push(asset);
			Log('WARN', `Skipping download due to previous failure : ${asset.url}`);
			continue;
		}

		const buffer = await DownloadURL(asset.url)
		.catch((err) => {
			Log('ERROR', err);
			return null;
		});
		if (buffer === null) {
			const connected = await TestConnection();
			if (!connected) {
				noInternet = true;
				Log('ERROR', `No internet connection, stopping downloads`);
				failedDownloads.push(asset);
			}
			continue;
		}

		// write to disk for later upload
		const savePath = `${UPLOAD_CACHE_PATH}/${asset.id}`;
		if (!fs.existsSync(UPLOAD_CACHE_PATH)) fs.mkdirSync(UPLOAD_CACHE_PATH);
		await fs.promises.writeFile(savePath, buffer);

		if (asset.url.startsWith('https://cdn.discordapp.com/embed/avatars/')) {
			asset.url = `fbi-internal://default/${asset.id}`;
			if (process.env.DEV_MODE) Log('TRACE', `Setting default avatar for ${asset.id} : ${asset.url}`);
		}

		queuedAssets.push({
			type       : asset.type,
			discord_id : BigInt(asset.id),
			discord_url: asset.url,
			name       : RemoveNonASCII(asset.name),
			width      : asset.width,
			height     : asset.height,
			size       : buffer.length
		})
	}

	await Database.batch(`
        INSERT INTO Assets (type, discord_id, discord_url, name, width, height, size)
        VALUES (?, ?, ?, ?, ?, ?, ?)

        -- Already exists, update in place, no need for delete
        ON DUPLICATE KEY
            UPDATE type        = VALUES(type),
                   discord_id  = VALUES(discord_id),
                   discord_url = VALUES(discord_url),
                   name        = VALUES(name),
                   width       = VALUES(width),
                   height      = VALUES(height),
                   size        = VALUES(size),
                   hash        = NULL
	`, queuedAssets.map(x => [
		x.type,
		x.discord_id,
		x.discord_url,
		x.name,
		x.width,
		x.height,
		x.size
	]));

	const end = Date.now();
	const duration = end - start;

	if (failedDownloads.length > 0) {
		// write them to disk for later retry
		fs.writeFileSync(`${DOWNLOAD_CACHE_PATH}/${Date.now()}.json`, JSON.stringify(failedDownloads, null, 2));
	}

	Log('DEBUG', `Downloaded ${queue.length} assets in ${duration}ms - ${cacheHit}/${queue.length} cache hits`);
}

function RemoveNonASCII(input: string) {
	return input.replace(/[^\x20-\x7E]/g, '');
}

async function DownloadURL(url: string) {
	return new Promise<Buffer>((resolve, reject) => {
		https.get(url, {
			timeout: 5000,
			headers: {
				'Content-Type': 'application/octet-stream'
			}
		}, (response) => {
			if (response.statusCode !== 200) {
				reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
				return;
			}

			const data: Buffer[] = [];
			let size = 0;
			response.on('data', (chunk: Buffer) => {
				size += chunk.length;
				if (size > HUNDRED_MEGABYTES) {
					reject(new Error(`File too large: ${url}`));
					return;
				}
				data.push(chunk);
			});
			response.on('error', reject);

			response.on('end', () => {
				if (data.length === 0) {
					reject(new Error(`Empty response from '${url}'`));
					return;
				}
				if (response.statusCode !== 200) {
					reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
					return;
				}
				const buffer = Buffer.concat(data);
				resolve(buffer);
			});
		});
	});
}