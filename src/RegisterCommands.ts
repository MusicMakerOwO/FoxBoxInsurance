import * as Commands from "./Commands";
import { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord-api-types/v10";
import { Log } from "./Utils/Log";
import { InteractionContextType } from "discord.js";

import * as dotenv from "dotenv";
dotenv.config({ path: `${__dirname}/../.env` });

Log('INFO', '(/) Registering commands, please wait ...');

// This is all that the Routes.applicationCommands() method does, but we don't need the extra dependency if it's literally just a string lmao
// https://discord.com/developers/docs/tutorials/upgrading-to-application-commands#registering-commands
const PUBLIC_ROUTE = `https://discord.com/api/v10/applications/${process.env.APP_ID}/commands`;

const COMMAND_AVAILABILITY = [ InteractionContextType.Guild ];

const commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
for (const command of Object.values(Commands)) {
	const payload = command.data.toJSON();
	payload.contexts = COMMAND_AVAILABILITY;
	commands.push(payload)
	if ('aliases' in command) {
		for (const alias of command.aliases) {
			commands.push({ ... payload, name: alias });
		}
	}
}

( async() => {
	const response = await fetch(PUBLIC_ROUTE, {
		method: "PUT",
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bot ${process.env.TOKEN}`
		},
		body: JSON.stringify(commands)
	});
	if (response.ok) {
		Log('INFO', '(/) Finished!');
	} else {
		Log('ERROR', await response.text());
	}
})();