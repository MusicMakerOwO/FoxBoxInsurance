import * as dotenv from "dotenv";
dotenv.config({ path: `${__dirname}/../.env` });

import { ExportChannel } from "./Utils/Parsers/Export";
import { writeFileSync } from "node:fs";
import { Database } from "./Database";

( async() => {
	const channelExport = await ExportChannel({
		guildID: 717942553617498122n,
		channelID: 717942553617498127n,
		userID: 556949122003894296n,
		messageCount: 10_000,
		format: 4
	})

	writeFileSync(`${__dirname}/../output.html`, channelExport.data);

	await Database.destroy();
})();