import {
	ApplicationCommandOptionChoiceData, AttachmentPayload,
	AutocompleteInteraction,
	ButtonInteraction,
	ChatInputCommandInteraction, Interaction,
	ModalSubmitInteraction,
	SlashCommandBuilder, SlashCommandOptionsOnlyBuilder, SlashCommandSubcommandsOnlyBuilder, StringSelectMenuInteraction
} from "discord.js";
import {IClient} from "../Client";
import {ObjectValues} from "./HelperTypes";
import {Events} from "../Utils/DiscordConstants";
import { APIEmbed, APIModalInteractionResponseCallbackData } from "discord-api-types/v10";
import { DiscordActionRow, DiscordButton, DiscordStringSelect } from "./DiscordTypes";
import { TOS_FEATURES } from "../TOSConstants";
import { GUILD_FEATURES } from "./DatabaseTypes";
import { DiscordPermissions } from "../Utils/DiscordConstants";

type NoReply<T extends Interaction> = Omit<T, 'reply' | 'editReply' | 'deferReply' | 'deferUpdate' | 'respond' | 'followUp'>;

interface ComponentSettings {
	usage?: string;
	examples?: string[];

	/** Dictates how to defer the response - modals do not get deferred */
	response_type: 'reply' | 'update' | 'modal';
	/** Alias for "ephemeral" */
	hidden: boolean;

	/** Requires the user to accept tos for these required features */
	tos_features: ObjectValues<typeof TOS_FEATURES>[];
	/** This component can only be used if the server has all of these features enabled */
	guild_features: ObjectValues<typeof GUILD_FEATURES>[];
	/** Set of permissions the user is required to have. Administrator bypasses this entirely. */
	permissions: ObjectValues<typeof DiscordPermissions>[];
}

export type InteractionResponse = {
	embeds?: APIEmbed[],
	components?: (DiscordActionRow<DiscordButton> | DiscordActionRow<DiscordStringSelect>)[]
	files?: AttachmentPayload[]
}

export interface CommandHandler extends ComponentSettings {
	data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
	aliases?: string[];
	autocomplete?: (interaction: NoReply<AutocompleteInteraction>, client: IClient) => Promise<ApplicationCommandOptionChoiceData[]>;
	execute: (interaction: NoReply<ChatInputCommandInteraction>, client: IClient) => Promise<APIModalInteractionResponseCallbackData | InteractionResponse>
}

export interface ButtonHandler extends ComponentSettings {
	customID: string;
	execute: (interaction: NoReply<ButtonInteraction>, client: IClient, args: string[]) => Promise<APIModalInteractionResponseCallbackData | InteractionResponse>;
}

export interface SelectMenuHandler extends ComponentSettings {
	customID: string;
	execute: (interaction: NoReply<StringSelectMenuInteraction>, client: IClient, args: string[]) => Promise<APIModalInteractionResponseCallbackData | InteractionResponse>;
}

export interface ModalHandler extends ComponentSettings {
	response_type: Extract<ComponentSettings['response_type'], 'reply' | 'update'>
	customID: string;
	execute: (interaction: NoReply<ModalSubmitInteraction>, client: IClient, args: string[]) => Promise<InteractionResponse>;
}

export interface EventHandler extends Omit<ComponentSettings, 'response_type' | 'hidden'> {
	name: ObjectValues<typeof Events> | string & {};
	once?: boolean;
	execute: (...args: any[]) => Promise<unknown>;
}