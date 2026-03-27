type NumberOptions = {
	min: number;
	max: number;
	/** @default false */
	allow_decimals: boolean;
}
export function ValidNumber(x: number, opts: Partial<NumberOptions> = {}): boolean {
	// also checks NaN
	if (!Number.isFinite(x)) return false;
	if (x > Number.MAX_SAFE_INTEGER) return false;
	if (x < Number.MIN_SAFE_INTEGER) return false;
	if (opts.min !== undefined && x < opts.min) return false;
	if (opts.max !== undefined && x > opts.max) return false;
	if (opts.allow_decimals === false && !Number.isInteger(x)) return false;
	return true;
}

type StringOptions = {
	min_length: number;
	max_length: number;
	/** Regex to test the string against */
	scheme: RegExp;
}
export function ValidString(x: string, opts: Partial<StringOptions> = {}): boolean {
	if (opts.min_length !== undefined) {
		if (!ValidNumber(opts.min_length)) throw new TypeError("min_length must be a positive integer");
		if (x.length < opts.min_length) return false;
	}
	if (opts.max_length !== undefined) {
		if (!ValidNumber(opts.max_length)) throw new TypeError("max_length must be a positive integer");
		if (x.length > opts.max_length) return false;
	}
	if (opts.scheme) {
		if (!x.match(opts.scheme)) return false;
	}
	return true;
}

export function ValidBigInt(x: string) {
	return ValidString(x, { scheme: /^\d+$/i });
}

/** 1 | 0 | boolean */
export function ValidBoolean(x: boolean | number): boolean {
	return typeof x === 'boolean' || x === 1 || x === 0;
}