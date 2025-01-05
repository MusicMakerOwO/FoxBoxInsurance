import { ComponentFile, MenuInteraction, MicroClient } from "../typings";

// Converting a select menu to a button
export default {
	customID: 'viewBackup',
	execute: async function (interaction: MenuInteraction, client: MicroClient, args: string[]) {
		const button = client.buttons.get('backup')!;
		await button.execute(interaction, client, [interaction.values[0], 'view']);
	}
} as ComponentFile;