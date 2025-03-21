module.exports = class CachePool {
	constructor (pools = 3) {
		this.cache = new Array(pools).fill(null).map(() => []);
		this.currentPool = 0;
	}

	switch () {
		this.currentPool = (this.currentPool + 1) % this.cache.length;
	}

	add (value) {
		this.cache[this.currentPool].push(value);
		return [ this.currentPool, this.cache[this.currentPool].length - 1 ];
	}

	#TestRange(pool) {
		if (!this.cache[pool]) throw new RangeError('Invalid pool - Mus be between 0 and ' + this.cache.length - 1);
	}
	
	clear (pool = this.currentPool) {
		if (pool === null) {
			this.cache = new Array(this.cache.length).fill(null).map(() => []);
		} else {
			this.#TestRange(pool);
			this.cache[pool] = [];
		}
	}

	isEmpty (pool = this.currentPool) {
		if (pool === null) {
			return this.cache.every(pool => pool.length === 0);
		} else {
			this.#TestRange(pool);
			return this.cache[pool].length === 0;
		}
	}

}