import { ButtonHandler, InteractionResponse } from "../../Typings/HandlerTypes.js";
import { COLOR, EMOJI, RESTORE_OPTION_NAMES, RESTORE_OPTIONS } from "../../Utils/Constants.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { DiscordActionRow, DiscordButton, DiscordButtonStyle } from "../../Typings/DiscordTypes.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";

/**
 * Shared screen-03 renderer - called both from this handler's own `execute` (after XORing a bit
 * into the mask) and from `Menus/RestorePreset.ts`'s "Custom" branch (initial entry, mask = 0).
 * The two callers have different customID arg shapes (a toggle needs a `bit`, initial entry
 * doesn't), so this is a plain function rather than one delegating to the other's `execute`.
 */
export function RenderToggleScreen(id: string, mask: number): InteractionResponse {
	const optionsRow: DiscordActionRow<DiscordButton> = {
		type: 1,
		components: (Object.keys(RESTORE_OPTIONS) as (keyof typeof RESTORE_OPTIONS)[]).map(key => {
			const bit = RESTORE_OPTIONS[key];
			const isMessages = key === 'MESSAGES';

			return {
				type: 2,
				style: !isMessages && (mask & bit) ? DiscordButtonStyle.SUCCESS : DiscordButtonStyle.SECONDARY,
				label: RESTORE_OPTION_NAMES[bit],
				custom_id: `restore-toggle_${id}_${mask}_${bit}`,
				disabled: isMessages,
			}
		})
	}

	const previewRow: DiscordActionRow<DiscordButton> = {
		type: 1,
		components: [{
			type: 2,
			style: DiscordButtonStyle.PRIMARY,
			label: 'Preview',
			emoji: { name: EMOJI.SEARCH },
			custom_id: `restore-preview_${id}_${mask}`,
			disabled: mask === 0,
		}]
	}

	return {
		embeds: [{
			color: COLOR.PRIMARY,
			title: 'Custom Restore Scope',
			description: mask === 0
				? 'Nothing selected yet - toggle at least one category below.'
				: 'Toggle categories on or off, then preview the changes.'
		}],
		components: [optionsRow, previewRow]
	}
}

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.RESTORE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : true,
	customID      : 'restore-toggle',
	execute       : async function(interaction, client, args) {
		const [id, maskArg, bitArg] = args;
		const currentMask = parseInt(maskArg) || 0;
		const bit = parseInt(bitArg) || 0;

		return RenderToggleScreen(id, currentMask ^ bit);
	}
} satisfies ButtonHandler as ButtonHandler;
