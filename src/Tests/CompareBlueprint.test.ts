import { describe, it, expect } from 'vitest';
import { CompareBlueprint, JSONBlueprint } from '../Utils/Snapshots/Imports/CompareBlueprint';

describe('CompareBlueprint', () => {
  it('returns true for exact match with required fields', () => {
    const blueprint = { a: 'string', b: 'number', c: 'boolean' } as const satisfies JSONBlueprint;
    const data = { a: 'foo', b: 42, c: true };
    expect(CompareBlueprint(data, blueprint)).toBe(true);
  });

  it('returns true for nullable fields with null values', () => {
    const blueprint = { a: 'string?', b: 'number?', c: 'boolean?' }  as const satisfies JSONBlueprint;
    const data = { a: null, b: null, c: null };
    expect(CompareBlueprint(data, blueprint)).toBe(true);
  });

  it('returns true for nullable fields with non-null values', () => {
    const blueprint = { a: 'string?', b: 'number?', c: 'boolean?' } as const satisfies JSONBlueprint;
    const data = { a: 'bar', b: 1, c: false };
    expect(CompareBlueprint(data, blueprint)).toBe(true);
  });

  it('returns false if a required field is null', () => {
    const blueprint = { a: 'string', b: 'number' } as const satisfies JSONBlueprint;
    const data = { a: null, b: 2 };
    expect(CompareBlueprint(data, blueprint)).toBe(false);
  });

  it('returns false if a field is missing', () => {
    const blueprint = { a: 'string', b: 'number' } as const satisfies JSONBlueprint;
    const data = { a: 'foo' };
    expect(CompareBlueprint(data, blueprint)).toBe(false);
  });

  it('returns false if an extra field is present', () => {
    const blueprint = { a: 'string' } as const satisfies JSONBlueprint;
    const data = { a: 'foo', b: 1 };
    expect(CompareBlueprint(data, blueprint)).toBe(false);
  });

  it('returns false if a field has the wrong type', () => {
    const blueprint = { a: 'string', b: 'number' } as const satisfies JSONBlueprint;
    const data = { a: 'foo', b: 'notanumber' };
    expect(CompareBlueprint(data, blueprint)).toBe(false);
  });

  it('returns false if a nullable field has the wrong type', () => {
    const blueprint = { a: 'string?' } as const satisfies JSONBlueprint;
    const data = { a: 123 };
    expect(CompareBlueprint(data, blueprint)).toBe(false);
  });

  it('returns true if object keys are out of order', () => {
    const blueprint = { a: 'string', b: 'number' } as const satisfies JSONBlueprint;
    const data = { b: 1, a: 'foo' };
    expect(CompareBlueprint(data, blueprint)).toBe(true);
  });
});