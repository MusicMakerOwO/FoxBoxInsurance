const https = require('https');
module.exports = async function Upload(name, extension, data, downloadLimit = 0) {
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
				'name': name,
				'ext': extension,
				'key': process.env.CDN_KEY,
				'download-limit': downloadLimit || null, // 0 -> null -> no limit
			}
		}, (response) => {
			const data = [];
			response.on('data', chunk => data.push(chunk));
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

		function OnError(reason) {
			reject(`Failed to upload asset: ${reason}`);
			request.destroy();
		}

		request.on('error', OnError);
		request.on('timeout', OnError);

		request.write(data);
		request.end();
	});
}