// strip discord formatting from a string
export function RemoveFormatting(text: string): string {
	if (text.length === 0) return text;

	const result = text
	.replace(/([*_~`|])/g, '\\$1') // bold/italic/underline/strikethrough/code/spoiler markers
	.replace(/^(>{1,3} ?)/gm, (match) => match.replace(/>/g, '\\>')); // blockquotes, on any line

	return result.trim();
}