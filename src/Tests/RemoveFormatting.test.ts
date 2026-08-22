import { describe, it, expect } from 'vitest';
import { RemoveFormatting } from '../Utils/RemoveFormatting.js';

describe('RemoveFormatting', () => {
	it('escapes bold markers without leaving double-escaped asterisks', () => {
		expect(RemoveFormatting('**VIP**')).toBe('\\*\\*VIP\\*\\*');
	});

	it('escapes inline code, spoiler, and strikethrough markers', () => {
		expect(RemoveFormatting('a `code` b ||spoiler|| c ~~strike~~')).toBe('a \\`code\\` b \\|\\|spoiler\\|\\| c \\~\\~strike\\~\\~');
	});

	it('escapes a triple-backtick code block instead of leaving it unescaped', () => {
		expect(RemoveFormatting('```js\ncode\n```')).not.toContain('```');
	});

	it('escapes blockquote markers on every line, not just the first', () => {
		const result = RemoveFormatting('> line one\n> line two');
		expect(result).toBe('\\> line one\n\\> line two');
	});

	it('returns an empty string unchanged', () => {
		expect(RemoveFormatting('')).toBe('');
	});
});
