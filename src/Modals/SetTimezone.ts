import { InteractionResponse, ModalHandler } from "../Typings/HandlerTypes.js";
import { SetTimezone } from "../CRUD/UserTimezones.js";
import { CurrentTimeIn, ResolveTimezone, TimezoneCandidate } from "../Utils/Timezones.js";
import { DiscordActionRow, DiscordButton, DiscordStringSelect } from "../Typings/DiscordTypes.js";
import { COLOR } from "../Utils/Constants.js";
import { IsActivitySpan } from "../Buttons/Activity.js";
import { ButtonInteraction } from "discord.js";

/**
 * A menu of zones to choose between.
 *
 * The chosen zone travels in the option `value`, never the custom_id - GlobalHandler splits custom_ids
 * on `_`, and half the IANA names contain one.
 */
function TimezoneMenu(candidates: TimezoneCandidate[], args: string[], withClock: boolean): DiscordActionRow<DiscordStringSelect> {
	return {
		type: 1,
		components: [{
			type: 3,
			custom_id: `pick-timezone_${args.join('_')}`,
			options: candidates.map(candidate => withClock
				? {
					label: `${candidate.abbreviation} — it's currently ${CurrentTimeIn(candidate.iana)}`,
					description: candidate.region,
					value: candidate.iana
				}
				: {
					label: `${candidate.abbreviation} — ${candidate.region}`,
					value: candidate.iana
				}
			)
		}]
	};
}

/**
 * Reopens the timezone modal. Sits under every screen that did not store a zone, so a list without
 * the right answer on it is never a dead end.
 */
export function TryAgainRow(args: string[]): DiscordActionRow<DiscordButton> {
	return {
		type: 1,
		components: [{
			type: 2,
			label: 'Try again',
			custom_id: `set-timezone_${args.join('_')}`,
			style: 2
		}]
	};
}

export default {
	tos_features: [],
	guild_features: [],
	permissions: [],
	response_type: 'update',
	hidden: false,
	customID: 'set-timezone',
	execute: async function(interaction, client, args) {
		// The args go on to the chart untouched, so a span it would refuse is refused before the zone
		// is stored rather than after
		if (!IsActivitySpan(args[0])) throw new Error(`Invalid time interval: ${args[0]}`);

		const input = interaction.fields.getTextInputValue('data');
		const resolution = ResolveTimezone(input);

		// Anything other than an exact match is put back to the user - the old behaviour silently
		// stored UTC for typos, so charts came out hours off with nothing to explain why.
		// `files: []` on each takes the chart image off the message, it would sit above the embed otherwise
		switch (resolution.kind) {
			case 'ambiguous':
				return {
					embeds: [{
						color: COLOR.PRIMARY,
						title: `Which ${resolution.input} do you mean?`,
						description: `A few places share the abbreviation **${resolution.input}**. Pick the one showing your current time:`
					}],
					files: [],
					components: [TimezoneMenu(resolution.candidates, args, true), TryAgainRow(args)]
				};

			case 'suggestions':
				return {
					embeds: [{
						color: COLOR.PRIMARY,
						title: 'Did you mean one of these?',
						description: `I could not match **${resolution.input}** to a timezone.`
					}],
					files: [],
					components: [TimezoneMenu(resolution.candidates, args, false), TryAgainRow(args)]
				};

			case 'unknown':
				return {
					embeds: [{
						color: COLOR.ERROR,
						title: 'Unknown timezone',
						description: [
							`I could not match **${resolution.input || 'that'}** to a timezone.`,
							'',
							'You can enter any of:',
							'- an abbreviation, like `EST`, `CET` or `JST`',
							'- a UTC offset in whole hours, like `UTC+2` or `-5`',
							'- an IANA zone name, like `Europe/London`'
						].join('\n')
					}],
					files: [],
					components: [TryAgainRow(args)]
				};
		}

		await SetTimezone(interaction.user.id, resolution.zone);
		const button = client.buttons.get('activity')!;
		return await button.execute(interaction as unknown as ButtonInteraction, client, args) as InteractionResponse;
	}
} satisfies ModalHandler as ModalHandler;
