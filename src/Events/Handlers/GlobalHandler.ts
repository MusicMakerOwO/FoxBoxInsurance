import {EventHandler} from "../../Typings/HandlerTypes";
import {Log} from "../../Utils/Log";
import {Database} from "../../Database";
import {Interaction} from "discord.js";
import { client } from "../../Client";

export default {
	name: 'interactionCreate',
	execute: async function (interaction: Interaction) {

		// @ts-ignore
		const args: string[] = interaction.customId?.split("_") ?? [];
		// @ts-ignore
		const name: string = args.shift() ?? interaction.commandName;

		let type: string = 'unknown';

		switch (interaction.type) {
			case 4: // Autocomplete
			case 2: // Slash Commands + Context Menus
				if (interaction.commandType === 1) {
					// @ts-ignore | Private properties
					const subcommand: string = interaction.options._subcommand || "";
					// @ts-ignore
					const subcommandGroup: string = interaction.options._subcommandGroup || "";
					// @ts-ignore
					const commandArgs: { value: string }[] = interaction.options._hoistedOptions || [];
					const args = `${subcommandGroup} ${subcommand} ${commandArgs.map(arg => arg.value).join(" ")}`.trim();
					Log('INFO', `${interaction.user.tag} (${interaction.user.id}) > /${interaction.commandName} ${args}`);
					client.emit('command-interaction', interaction);
					type = 'command';
				} else {
					Log('INFO', `${interaction.user.tag} (${interaction.user.id}) > :${interaction.commandName}:`);
					client.emit('context-interaction', interaction);
					type = 'context';
				}
				break;
			case 3: // Message Components
				if (interaction.isButton()) {
					Log('INFO', `${interaction.user.tag} (${interaction.user.id}) > [${interaction.customId}]`);
					client.emit('button-interaction', interaction);
					type = 'button';
				} else if (interaction.isAnySelectMenu()) {
					Log('INFO', `${interaction.user.tag} (${interaction.user.id}) > <${interaction.customId} : ${interaction.values.join(', ')}>`);
					client.emit('menu-interaction', interaction);
					type = 'menu';
				}
				break;
			case 5: // Modal submit
				Log('INFO', `${interaction.user.tag} (${interaction.user.id}) > {${interaction.customId}}`);
				client.emit('modal-interaction', interaction);
				type = 'modal';
				break;
			default:
				Log('WARN', `Unknown interaction type: ${interaction.type} - Unsure how to handle this...`);
				type = 'unknown';
				break;
		}

		void Database.query(`
			INSERT INTO InteractionLogs (guild_id, channel_id, user_id, type, name)
			VALUES (?, ?, ?, ?, ?)
		`, [
			interaction.guildId,
			interaction.channelId,
			interaction.user.id,
			type,
			name
		]);
	}
} as EventHandler;