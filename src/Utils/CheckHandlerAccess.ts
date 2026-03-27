import { AutocompleteInteraction, CommandInteraction, GuildMember, Interaction } from "discord.js";
import {
	ButtonHandler,
	CommandHandler,
	InteractionResponse,
	ModalHandler,
	SelectMenuHandler
} from "../Typings/HandlerTypes";
import { GetUser } from "../CRUD/Users";
import { COLOR, EMOJI } from "./Constants";
import { GetGuild } from "../CRUD/Guilds";
import { DiscordActionRow, DiscordButton } from "../Typings/DiscordTypes";
import { CanUserAccessTOSFeature } from "../Services/UserTOS";
import { ListSupportVersionsWithFeature, TOS_FEATURE_DESCRIPTION } from "../CRUD/TOSVersion";
import { TOS_FEATURES, TOS_VERSIONS } from "../TOSConstants";
import { ObjectValues } from "../Typings/HelperTypes";
import { SimpleUser } from "../Typings/DatabaseTypes";

/**
 * Determines the next required TOS version for the user based on disallowed features
 * @returns The next required TOS version number, or null if not found.
 */
export function GetNextRequiredTOSVersion(
	disallowedFeatures: ObjectValues<typeof TOS_FEATURES>[],
	savedUser: Pick<SimpleUser, 'terms_version_accepted'>
): number | null {
	const requiredVersions = disallowedFeatures
	.flatMap(feature => ListSupportVersionsWithFeature(feature))
	.filter(v => v > savedUser.terms_version_accepted);

	if (requiredVersions.length === 0) return null;

	return Math.min(...requiredVersions);
}

/** Builds a changelist of TOS features added/removed between two TOS versions */
export function BuildTOSChangeList(fromVersion: number, toVersion: number): string[] {
	const changes: string[] = [];
	const seen = new Set<number>();
	for (let v = fromVersion + 1; v <= toVersion; v++) {
		const tosData = TOS_VERSIONS[v];
		if (!tosData) continue;
		for (const feature of tosData.added) {
			if (!seen.has(feature)) {
				changes.push(`Added ${TOS_FEATURE_DESCRIPTION[feature]}`);
				seen.add(feature);
			}
		}
		for (const feature of tosData.removed) {
			if (seen.has(feature)) {
				changes.push(`Removed ${TOS_FEATURE_DESCRIPTION[feature]}`);
				seen.delete(feature);
			}
		}
	}
	return changes;
}

const USER_TOS_Embed = {
	color: COLOR.PRIMARY,
	description: `
You are required to accept the Terms of Service before using this bot

By agreeing to the Terms you are agreeing to the following:
- You will not use this bot for illegal purposes
- You will not use the data for blackmail, harassment, doxxing, or any other malicious intent
- You will abide by the [Discord ToS](https://discord.com/terms) and [Community Guidelines](https://discord.com/guidelines)
- If you are caught violating these terms you will be banned from using this bot

You can find a fully copy of the terms here : https://www.notfbi.dev/terms`
}

const USER_TOS_BUTTONS: DiscordActionRow<DiscordButton> = {
	type: 1,
	components: [
		{
			type: 2,
			style: 4,
			label: 'Decline',
			custom_id: 'close'
		},
		{
			type: 2,
			style: 3,
			label: 'Accept',
			custom_id: 'tos-accept'
		}
	]
}

/** Returns an interaction response object with the error or null if the user is allowed to execute the command */
export async function CheckHandlerAccess (
	interaction: Exclude<Interaction, AutocompleteInteraction>,
	handler: CommandHandler | ButtonHandler | SelectMenuHandler | ModalHandler
): Promise<InteractionResponse | null> {
	if (interaction instanceof CommandInteraction || handler.response_type === 'reply') {
		await interaction.deferReply({ flags: handler.hidden ? 64 : undefined });
	} else if (handler.response_type === 'update') {
		await interaction.deferUpdate();
	}

	const savedUser = (await GetUser(interaction.user.id))!;
	if (savedUser.terms_version_accepted === 0) {
		// Force users to accept TOS
		return { embeds: [USER_TOS_Embed], components: [USER_TOS_BUTTONS] };
	}
	const disallowedFeatures = handler.tos_features.filter(x => !CanUserAccessTOSFeature(savedUser, x));
	if (disallowedFeatures.length > 0) {
		const nextTOSVersion = GetNextRequiredTOSVersion(disallowedFeatures, savedUser);

		if (nextTOSVersion === null) {
			return {
				embeds: [{
					title: 'Feature Unavailable',
					description: 'This feature is not available to you because it requires terms that are no longer available.'
				}]
			};
		}

		const changes = BuildTOSChangeList(savedUser.terms_version_accepted, nextTOSVersion);

		const embed = {
			color: COLOR.PRIMARY,
			title: "Terms of Service",
			description: `
Use of this feature requires you to accept the updated terms of service.
If you do not accept these changes, you may continue using the bot, but some features will be limited.

Here is a brief list of the changes:
${changes.map(x => `  \\- ${x}`).join('\n')}

You can also view the full terms here: https://notfbi.dev/terms/${nextTOSVersion}
`.trim()
		};

		return {
			embeds: [embed],
			components: [{
				type: 1,
				components: [
					{
						type: 2,
						style: 4,
						label: 'Decline',
						custom_id: 'close'
					},
					{
						type: 2,
						style: 4,
						label: 'Accept',
						custom_id: `tos-accept_${nextTOSVersion}`
					}
				]
			}]
		};
	}

	if (handler.guild_features.length > 0) {
		const savedGuild = (await GetGuild(interaction.guildId!))!;
		for (const requiredFeature of handler.guild_features) {
			if ( (savedGuild.features & requiredFeature) === 0) return {
				embeds: [{
					color: COLOR.ERROR,
					title: "Feature Disabled",
					description: `
${EMOJI.WARNING} This feature has been disabled within this server
If you believe this is a mistake please contact the server admins`
				}],
			}
		}
	}

	if (handler.permissions.length > 0) {
		const memberPermissions = (interaction.member as GuildMember).permissions
		const missingPermissions = handler.permissions.filter(x => !memberPermissions.has(x));
		if (missingPermissions.length > 0) return {
			embeds: [{
				color: COLOR.ERROR,
				description: `
You cannot use this feature at this time :(
You are missing the following permissions:
${missingPermissions.map(permission => '\\- ' + permission).join("\n")}`
			}]
		}
	}

	return null;
}