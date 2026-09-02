import { SelectMenuHandler } from "../Typings/HandlerTypes.js";
import { ButtonInteraction } from "discord.js";
import { TOS_FEATURES } from "../TOSConstants.js";
import { GUILD_FEATURES } from "../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../Utils/DiscordConstants.js";
import { RESTORE_PRESETS } from "../Utils/Constants.js";
import { RenderToggleScreen } from "../Buttons/Restore/Toggle.js";

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.RESTORE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : true,
	customID      : 'restore-preset',
	execute       : async function(interaction, client, args) {
		const id = args[0];
		const preset = interaction.values[0];

		// Custom has no fixed mask - render the toggle screen directly rather than faking a
		// `restore-toggle` delegation (that customID shape expects a `bit` this call doesn't have)
		if (preset === 'custom') {
			return RenderToggleScreen(id, RESTORE_PRESETS.CUSTOM);
		}

		const presetKey = preset.toUpperCase() as Uppercase<Exclude<keyof typeof RESTORE_PRESETS, 'CUSTOM'>>;
		const mask = RESTORE_PRESETS[presetKey] ?? RESTORE_PRESETS.CUSTOM;

		const button = client.buttons.get('restore-preview')!;
		return button.execute(interaction as unknown as ButtonInteraction, client, [id, String(mask)]);
	}
} satisfies SelectMenuHandler as SelectMenuHandler;
