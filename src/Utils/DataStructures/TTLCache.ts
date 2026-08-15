import { SECONDS } from "../Constants.js";

type CacheEntry<T> = { value: T, expiryTime: number, ttl: number };

export class TTLCache<K, V> {
	cache: Map<K, CacheEntry<V>>;
	interval: NodeJS.Timeout;

	constructor(checkInterval = SECONDS.MINUTE * 1000) {
		this.cache = new Map();

		// Start the interval to clean up expired items
		this.interval = setInterval(() => this.cleanup(), checkInterval).unref();
	}

	set(key: K, value: V, ttl = SECONDS.MINUTE * 10 * 1000): void {
		const expiryTime = Date.now() + ttl;
		this.cache.set(key, { value, expiryTime, ttl });
	}

	delete(key: K): void {
		this.cache.delete(key);
	}

	#isExpired(item: CacheEntry<V>) {
		return Date.now() > item.expiryTime;
	}

	has(key: K): boolean {
		const item = this.cache.get(key);
		if (!item) return false;

		if (this.#isExpired(item)) {
			this.cache.delete(key);
			return false;
		}

		return true;
	}


	get(key: K, touch = true): V | null {
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

	cleanup(): void {
		for (const [key, item] of this.cache.entries()) {
			if (this.#isExpired(item)) {
				this.cache.delete(key);
			}
		}
	}

	destroy(): void {
		clearInterval(this.interval);
		this.cache.clear();
	}

	keys(): K[] {
		return Array.from(this.cache.keys()).filter(key => this.has(key));
	}

	values(): V[] {
		return Array.from(this.cache.values())
			.filter(item => !this.#isExpired(item))
			.map(item => item.value);
	}
}