import https from "node:https";

// remove all non-ASCII characters
function CleanName(input: string) {
	return input.replace(/[^a-zA-Z0-9-_.]/g, '');
}

export async function UploadCDN(fileName: string, data: Buffer, downloadLimit: number | null) {
	// POST cdn.notfbi.dev/upload
	return new Promise((resolve, reject) => {
		const request = https.request({
			hostname: 'cdn.notfbi.dev',
			port: 443,
			path: '/upload',
			method: 'POST',
			headers: {
				'Content-Type': 'application/octet-stream',
				'Content-Length': data.length,
				'file-name': CleanName(fileName),
				'key': process.env.CDN_KEY,
				'download-limit': String(downloadLimit || null), // 0 -> null -> no limit
			}
		}, (response: any) => {
			const data: string[] = [];
			response.on('data', (chunk: string) => data.push(chunk));
			response.on('end', () => {
				switch (response.statusCode) {
					case 200:
					case 201:
						// Uploaded successfully, returned a hash to use for retrieval
						resolve( data.join('') );
						break;
					case 401: reject('Invalid key provided'); break;
					case 413: reject('File is too large'); break;
					default: reject(`Unknown error (${response.statusCode})`); break;
				}
			});
		});

		function OnError(reason: string) {
			reject(`Failed to upload asset: ${reason}`);
			request.destroy();
		}

		request.on('error', OnError);
		request.on('timeout', OnError);

		request.write(data);
		request.end();
	});
}