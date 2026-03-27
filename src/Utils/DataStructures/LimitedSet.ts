/** Bounded Set that evicts the oldest entry when capacity is exceeded */
export default class LimitedSet<T> extends Set<T> {
	private readonly maxSize: number;

	constructor(maxSize: number, iterable?: Iterable<T>) {
		if (!Number.isInteger(maxSize) || maxSize <= 0) {
			throw new Error('maxSize must be a positive integer');
		}
		super(iterable);
		this.maxSize = maxSize;
		this.trimExcess();
	}

	/** Evicts the oldest item if size is exceeded */
	add(value: T): this {
		super.add(value);
		this.trimExcess();
		return this;
	}

	private trimExcess(): void {
		while (this.size > this.maxSize) {
			const oldest = this.values().next().value as T | undefined;
			if (oldest === undefined) break;
			this.delete(oldest);
		}
	}
}