export default class TimedCache<K, V> {
	public cache: Map<K, { value: V, expires: number }>;
	public ttl: number;
	public interval: NodeJS.Timeout;
	public onExpire: null | ((key: K, value: V) => void);

	constructor(ttl: number) {
		this.cache = new Map();
		this.ttl = ttl;
		this.onExpire = null;
		this.interval = setInterval(() => this.prune(), ttl);
	}

	public set(key: K, value: V): void {
		this.cache.set(key, { value, expires: Date.now() + this.ttl });
	}

	public get(key: K): V | undefined {
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

	public delete(key: K): boolean {
		return this.cache.delete(key);
	}

	public prune(): void {
		for (const [key, entry] of this.cache) {
			if (entry.expires < Date.now()) {
				this.cache.delete(key);
				if (this.onExpire) this.onExpire(key, entry.value);
			}
		}
	}

	clear(): void {
		this.cache.clear();
	}

	stopCleanup(): void {
		clearInterval(this.interval);
	}
}