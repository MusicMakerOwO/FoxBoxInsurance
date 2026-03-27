const https = require('node:https');

let connected = false;
let lastTest = 0;

export async function TestConnection(): Promise<boolean> {
	if (Date.now() - lastTest < 1000 * 60) return connected;
	return new Promise( resolve => {
		const request = https.get({
			hostname: 'www.google.com',
			port: 443,
			path: '/',
			method: 'HEAD', // only fetches headers, ignore the rest of the webpage
			timeout: 5000
		}, function (response: any) {
			lastTest = Date.now();
			connected = response.statusCode === 200;
			response.destroy();
			request.destroy();
			resolve(connected);
		});

		function onError() {
			lastTest = Date.now();
			connected = false;
			request.destroy();
			resolve(false);
		}
		request.on('error', onError);
		request.on('timeout', onError);
		request.end();
	});
}