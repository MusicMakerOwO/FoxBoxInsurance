import {
	ButtonInteraction,
	ChatInputCommandInteraction,
	InteractionEditReplyOptions,
	InteractionReplyOptions,
	ModalSubmitInteraction,
	StringSelectMenuInteraction
} from "discord.js";
import { APIModalInteractionResponseCallbackData } from "discord-api-types/v10";
import { ButtonHandler, CommandHandler, InteractionResponse, ModalHandler, SelectMenuHandler } from "../../Typings/HandlerTypes.js";
import { COLOR } from "../../Utils/Constants.js";
import { Log } from "../../Utils/Log.js";
import { CheckHandlerAccess } from "../../Utils/CheckHandlerAccess.js";
import { client } from "../../Client.js";

// Not exported from ./index.ts - that barrel registers events, and this is shared by four of them

type ComponentInteraction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction | ChatInputCommandInteraction;
type ComponentHandler = ButtonHandler | SelectMenuHandler | ModalHandler | CommandHandler;

function HandlerName(handler: ComponentHandler): string {
	return 'customID' in handler ? handler.customID : `/${handler.data.name}`;
}

const HANDLER_ERROR_RESPONSE = {
	embeds: [{
		color: COLOR.ERROR,
		description: "Something went wrong handling that, please try again later :("
	}],
	components: []
} satisfies InteractionResponse;

/** Edits the deferred reply, or replies when nothing acknowledged the interaction yet (modal-type handlers) */
function Acknowledge(interaction: ComponentInteraction, response: InteractionResponse, hidden: boolean) {
	return interaction.deferred || interaction.replied
		? interaction.editReply(response as InteractionEditReplyOptions)
		: interaction.reply({ ...response, flags: hidden ? 64 : undefined } as InteractionReplyOptions);
}

/**
 * Gate, run and answer a handler - a command counts as a component here, `args` is just unused.
 * Handlers only return data, so every outcome is sent from here:
 * - a denial from CheckHandlerAccess
 * - a modal (`response_type: 'modal'`), which must never have been deferred
 * - `{ delete: true }`, which deletes the deferred message instead of editing it
 * - `{ followUp }`, sent as an ephemeral follow-up, leaving the deferred message untouched
 * - anything else edits the deferred reply
 *
 * A handler that throws, returns nothing, or returns a non-modal from a modal-type handler leaves
 * the user an error embed instead of "thinking..." forever or a click that silently did nothing.
 */
export async function RunComponentHandler(interaction: ComponentInteraction, handler: ComponentHandler, args: string[]): Promise<void> {
	let response: APIModalInteractionResponseCallbackData | InteractionResponse;
	try {
		const errorResponse = await CheckHandlerAccess(interaction, handler);
		if (errorResponse) {
			await Acknowledge(interaction, errorResponse, false);
			return;
		}

		response = await (handler as ButtonHandler).execute(interaction as ButtonInteraction, client, args);
		if (!response) throw new Error(`No response received from handler '${HandlerName(handler)}'`);
		// A modal can only answer an un-deferred interaction, and anything else needs the deferral
		if ((handler.response_type === 'modal') !== ('title' in response)) {
			throw new Error(`Handler '${HandlerName(handler)}' is ${handler.response_type}-type but returned ${'title' in response ? 'a modal' : 'a non-modal'}`);
		}
	} catch (error) {
		Log('ERROR', error);
		try {
			await Acknowledge(interaction, HANDLER_ERROR_RESPONSE, true);
		} catch (sendError) {
			Log('ERROR', sendError);
		}
		return;
	}

	try {
		if ('title' in response) {
			await (interaction as ButtonInteraction).showModal(response);
		} else if (response.delete) {
			await interaction.deleteReply();
		} else if (response.followUp) {
			await interaction.followUp({ ...response.followUp, flags: 64 } as InteractionReplyOptions);
		} else {
			await interaction.editReply(response as InteractionEditReplyOptions);
		}
	} catch (error) {
		// The interaction expired or the message is gone - nothing left to answer
		Log('ERROR', error);
	}
}
