import { describe, it, expect } from 'vitest';
import { ValidNumber, ValidString, ValidBigInt, ValidBoolean } from '../../Utils/Snapshots/Imports/ParseUtils.js';

describe('ValidNumber', () => {
	it('rejects decimals by default, matching the documented @default false', () => {
		expect(ValidNumber(5.5)).toBe(false);
	});

	it('accepts integers by default', () => {
		expect(ValidNumber(5)).toBe(true);
	});

	it('accepts decimals when allow_decimals is explicitly true', () => {
		expect(ValidNumber(5.5, { allow_decimals: true })).toBe(true);
	});

	it('rejects decimals when allow_decimals is explicitly false', () => {
		expect(ValidNumber(5.5, { allow_decimals: false })).toBe(false);
	});

	it('rejects NaN', () => {
		expect(ValidNumber(NaN)).toBe(false);
	});

	it('rejects Infinity and -Infinity', () => {
		expect(ValidNumber(Infinity)).toBe(false);
		expect(ValidNumber(-Infinity)).toBe(false);
	});

	it('rejects values outside the safe integer range', () => {
		expect(ValidNumber(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
		expect(ValidNumber(Number.MIN_SAFE_INTEGER - 1)).toBe(false);
	});

	it('accepts values at the safe integer boundaries', () => {
		expect(ValidNumber(Number.MAX_SAFE_INTEGER)).toBe(true);
		expect(ValidNumber(Number.MIN_SAFE_INTEGER)).toBe(true);
	});

	it('enforces min', () => {
		expect(ValidNumber(4, { min: 5 })).toBe(false);
		expect(ValidNumber(5, { min: 5 })).toBe(true);
	});

	it('enforces max', () => {
		expect(ValidNumber(6, { max: 5 })).toBe(false);
		expect(ValidNumber(5, { max: 5 })).toBe(true);
	});
});

describe('ValidString', () => {
	it('accepts a string with no options', () => {
		expect(ValidString('anything')).toBe(true);
	});

	it('enforces min_length', () => {
		expect(ValidString('ab', { min_length: 3 })).toBe(false);
		expect(ValidString('abc', { min_length: 3 })).toBe(true);
	});

	it('enforces max_length', () => {
		expect(ValidString('abcd', { max_length: 3 })).toBe(false);
		expect(ValidString('abc', { max_length: 3 })).toBe(true);
	});

	it('throws if min_length is not a valid number', () => {
		expect(() => ValidString('abc', { min_length: 1.5 })).toThrow(TypeError);
	});

	it('throws if max_length is not a valid number', () => {
		expect(() => ValidString('abc', { max_length: 1.5 })).toThrow(TypeError);
	});

	it('enforces scheme', () => {
		expect(ValidString('abc123', { scheme: /^[a-z]+$/ })).toBe(false);
		expect(ValidString('abc', { scheme: /^[a-z]+$/ })).toBe(true);
	});
});

describe('ValidBigInt', () => {
	it('accepts a numeric-only string', () => {
		expect(ValidBigInt('123456789012345678')).toBe(true);
	});

	it('rejects an empty string', () => {
		expect(ValidBigInt('')).toBe(false);
	});

	it('rejects a negative sign', () => {
		expect(ValidBigInt('-1')).toBe(false);
	});

	it('rejects a decimal point', () => {
		expect(ValidBigInt('1.5')).toBe(false);
	});

	it('rejects non-digit characters', () => {
		expect(ValidBigInt('12a34')).toBe(false);
	});
});

describe('ValidBoolean', () => {
	it('accepts true and false', () => {
		expect(ValidBoolean(true)).toBe(true);
		expect(ValidBoolean(false)).toBe(true);
	});

	it('accepts 1 and 0', () => {
		expect(ValidBoolean(1)).toBe(true);
		expect(ValidBoolean(0)).toBe(true);
	});

	it('rejects other numbers', () => {
		expect(ValidBoolean(2)).toBe(false);
		expect(ValidBoolean(-1)).toBe(false);
	});
});
