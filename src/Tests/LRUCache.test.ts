import { describe, it, expect } from 'vitest';
import { LRUCache } from '../Utils/DataStructures/LRUCache.js';

describe('LRUCache', () => {
	it('returns a falsy value without evicting it', () => {
		const cache = new LRUCache<string, number>(10);
		cache.set('zero', 0);

		expect(cache.get('zero')).toBe(0);
		expect(cache.has('zero')).toBe(true);
		expect(cache.get('zero')).toBe(0); // still there on a second read
	});

	it('treats a falsy value as recently-used, not evicting it before an older truthy value', () => {
		const cache = new LRUCache<string, number | string | boolean>(2);
		cache.set('a', 1);
		cache.set('b', false); // falsy value

		cache.get('b'); // touch 'b' so it becomes most-recently-used
		cache.set('c', 3); // should evict 'a' (oldest), not 'b'

		expect(cache.has('a')).toBe(false);
		expect(cache.has('b')).toBe(true);
		expect(cache.get('b')).toBe(false);
	});

	it('evicts the oldest entry once the limit is exceeded', () => {
		const cache = new LRUCache<string, number>(2);
		cache.set('a', 1);
		cache.set('b', 2);
		cache.set('c', 3);

		expect(cache.has('a')).toBe(false);
		expect(cache.get('b')).toBe(2);
		expect(cache.get('c')).toBe(3);
	});
});
