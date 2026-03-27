export const DiscordButtonStyle = {
	PRIMARY: 1,
	SECONDARY: 2,
	SUCCESS: 3,
	DANGER: 4,
	LINK: 5
} as const;

type PartialEmoji = { name: string } | { id: string, name: string, animated: boolean }

type NormalButton = {
	type: 2,
	style:
		| typeof DiscordButtonStyle.PRIMARY
		| typeof DiscordButtonStyle.SECONDARY
		| typeof DiscordButtonStyle.SUCCESS
		| typeof DiscordButtonStyle.DANGER,
	label?: string,
	emoji?: PartialEmoji
	custom_id: string,
	disabled?: boolean
}

type LinkButton = {
	type: 2,
	style: typeof DiscordButtonStyle.LINK,
	url: string,
	label: string,
	emoji?: PartialEmoji
	disabled?: boolean
}

export type DiscordButton = NormalButton | LinkButton;

export type DiscordStringSelectOption = {
	label: string,
	value: string,
	description?: string,
	emoji?: PartialEmoji
}

export type DiscordStringSelect = {
	type: 3,
	custom_id: string,
	options: DiscordStringSelectOption[],
	required?: boolean
	disabled?: boolean,
	min_values?: number,
	max_values?: number,
}

export type DiscordActionRow<T extends DiscordButton | DiscordStringSelect> = {
	type: 1,
	components: T[]
}