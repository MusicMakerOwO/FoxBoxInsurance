const FORMATS = [
	/\*\*/g, // bold
	/\_\_/g, // underline
	/\*/g, // italic
	/\_/g, // italic (underscore)
	/\~\~/g, // strikethrough
	/\`/g, // inline code
	/\`\`\`/g, // code block
	/\|\|/g, // spoiler
	/^\> /g, // blockquote
	/^\>\>\> /g // blockquote (multi-line)
]

// strip discord formatting from a string
module.exports = function RemoveFormatting(text) {
	if (typeof text !== 'string') throw new TypeError('Expected a string to remove formatting from.');
	if (text.length === 0) return text;

	let result = text;
	for (const format of FORMATS) {
		result = result.replace(format, '\\$&'); // escape the formatting characters
	}
	
	return result.trim();
}