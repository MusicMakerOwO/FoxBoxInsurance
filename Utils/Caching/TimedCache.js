const FIVE_MINUTES = 5 * 60 * 1000;

module.exports = class TimedCache {
	constructor(ttl = FIVE_MINUTES) {
		this.cache = new Map();
		this.ttl = ttl;
		this.onExpire = null;
		this.interval = setInterval( () => this.prune(), this.ttl);
	}

	has(key) {
		const entry = this.cache.get(key);
		if (!entry) return false;
		if (entry.expires < Date.now()) {
			this.cache.delete(key);
			if (this.onExpire) this.onExpire(key, entry.value);
			return false;
		}
		return true;
	}

	set(key, value) {
		this.cache.set(key, { value, expires: Date.now() + this.ttl });
	}

	get(key) {
		const entry = this.cache.get(key);
		if (!entry) return undefined;
		if (entry.expires < Date.now()) {
			this.cache.delete(key);
			if (this.onExpire) this.onExpire(key, entry.value);
			return undefined;
		}
		// reset the expiration time
		this.set(key, entry.value);
		return entry.value;
	}

	delete(key) {
		return this.cache.delete(key);
	}

	prune() {
		for (const [key, entry] of this.cache.entries()) {
			if (entry.expires < Date.now()) {
				this.cache.delete(key);
				if (this.onExpire) this.onExpire(key, entry.value);
			}
		}
	}

	clear() {
		this.cache.clear();
	}

	destroy() {
		clearInterval(this.interval);
	}
}