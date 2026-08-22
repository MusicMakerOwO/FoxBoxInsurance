import https from 'node:https';
import { IncomingMessage } from "node:http";

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
		}, function (response: IncomingMessage) {
			lastTest = Date.now();
			// any HTTP response (even a non-200) proves DNS/TCP/TLS are working - only a network-level error means no internet
			connected = response.statusCode !== undefined;
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