// each item in the cache will expire after a specified time-to-live (TTL).

const { SECONDS } = require("../Constants");

module.exports = class TTLCache {
	constructor(checkInterval = SECONDS.MINUTE * 1000) {
		this.cache = new Map();

		// Start the interval to clean up expired items
		this.interval = setInterval(() => this.cleanup(), checkInterval);
	}

	set(key, value, ttl = SECONDS.MINUTE * 10 * 1000) {
		const expiryTime = Date.now() + ttl;
		this.cache.set(key, { value, expiryTime, ttl });
	}

	delete(key) {
		this.cache.delete(key);
	}

	#isExpired(item) {
		return Date.now() > item.expiryTime;
	}

	has(key) {
		const item = this.cache.get(key);
		if (!item) return false;

		if (this.#isExpired(item)) {
			this.cache.delete(key);
			return false;
		}

		return true;
	}


	get(key, touch = true) {
		const item = this.cache.get(key);
		if (!item) return null;

		if (this.#isExpired(item)) {
			this.cache.delete(key);
			return null;
		}

		if (touch) {
			// Update the expiry time to extend the TTL
			item.expiryTime = Date.now() + item.ttl;
			this.cache.set(key, item);
		}

		return item.value;
	}

	cleanup() {
		const now = Date.now();
		for (const [key, item] of this.cache.entries()) {
			if (this.#isExpired(item)) {
				this.cache.delete(key);
			}
		}
	}
	
	destroy() {
		clearInterval(this.interval);
		this.cache.clear();
	}
}