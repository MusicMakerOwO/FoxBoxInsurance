export class LRUCache<K, V> {
	limit: number;
	cache: Map<K, V>;

	constructor(limit: number) {
		this.limit = limit;
		this.cache = new Map();
	}

	has(key: K): boolean {
		return this.cache.has(key);
	}

	set(key: K, value: V): void {
		if (this.cache.has(key)) {
			this.cache.delete(key);
			this.cache.set(key, value);
			return;
		}

		if (this.cache.size >= this.limit) {
			const oldestKey = this.cache.keys().next().value!;
			this.cache.delete(oldestKey);
		}

		this.cache.set(key, value);
	}

	get(key: K): V | null {
		if (!this.cache.has(key)) return null;

		const value = this.cache.get(key);

		this.cache.delete(key);
		if (value) this.cache.set(key, value);

		return value ?? null;
	}

	delete(key: K): boolean {
		return this.cache.delete(key);
	}
}