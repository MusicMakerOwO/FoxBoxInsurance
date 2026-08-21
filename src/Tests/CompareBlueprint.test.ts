import { describe, it, expect } from 'vitest';
import { CompareBlueprint, JSONBlueprint } from '../Utils/Snapshots/Imports/CompareBlueprint.js';

describe('CompareBlueprint', () => {
	it('returns true for exact match with required fields', () => {
		const blueprint = { name: 'string', age: 'number', active: 'boolean' } as const satisfies JSONBlueprint;
		const data = { name: 'Alice', age: 30, active: true };
		expect(CompareBlueprint(data, blueprint)).toBe(true);
	});

	it('returns true for nullable fields with null values', () => {
		const blueprint = { name: 'string', nickname: 'string?' } as const satisfies JSONBlueprint;
		const data = { name: 'Alice', nickname: null };
		expect(CompareBlueprint(data, blueprint)).toBe(true);
	});

	it('returns true for nullable fields with non-null values', () => {
		const blueprint = { name: 'string', nickname: 'string?' } as const satisfies JSONBlueprint;
		const data = { name: 'Alice', nickname: 'Al' };
		expect(CompareBlueprint(data, blueprint)).toBe(true);
	});

	it('returns false if a required field is null', () => {
		const blueprint = { name: 'string', age: 'number' } as const satisfies JSONBlueprint;
		const data = { name: null, age: 30 };
		expect(CompareBlueprint(data, blueprint)).toBe(false);
	});

	it('returns false if a field is missing', () => {
		const blueprint = { name: 'string', age: 'number' } as const satisfies JSONBlueprint;
		const data = { name: 'Alice' };
		expect(CompareBlueprint(data, blueprint)).toBe(false);
	});

	it('returns false if an extra field is present', () => {
		const blueprint = { name: 'string' } as const satisfies JSONBlueprint;
		const data = { name: 'Alice', extra: 'unexpected' };
		expect(CompareBlueprint(data, blueprint)).toBe(false);
	});

	it('returns false if a field has the wrong type', () => {
		const blueprint = { age: 'number' } as const satisfies JSONBlueprint;
		const data = { age: '30' };
		expect(CompareBlueprint(data, blueprint)).toBe(false);
	});

	it('returns false if a nullable field has the wrong type', () => {
		const blueprint = { nickname: 'string?' } as const satisfies JSONBlueprint;
		const data = { nickname: 42 };
		expect(CompareBlueprint(data, blueprint)).toBe(false);
	});

	it('returns true if object keys are out of order', () => {
		const blueprint = { name: 'string', age: 'number' } as const satisfies JSONBlueprint;
		const data = { age: 30, name: 'Alice' };
		expect(CompareBlueprint(data, blueprint)).toBe(true);
	});
});
