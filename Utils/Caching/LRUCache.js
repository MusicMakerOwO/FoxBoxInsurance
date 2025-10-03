module.exports = class LRUCache {
	constructor(limit) {
		this.limit = limit;
		this.cache = new Map();
	}

	has(key) {
		return this.cache.has(key);
	}

	set(key, value) {
		if (this.cache.has(key)) {
			this.cache.delete(key);
			this.cache.set(key, value);
			return;
		}

		if (this.cache.size >= this.limit) {
			const oldestKey = this.cache.keys().next().value;
			this.cache.delete(oldestKey);
		}

		this.cache.set(key, value);
	}

	get(key) {
		if (!this.cache.has(key)) return null;

		const value = this.cache.get(key);

		this.cache.delete(key);
		this.cache.set(key, value);

		return value;
	}
}