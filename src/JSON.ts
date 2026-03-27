/** Replaces bigints and buffers with strings */
export function JSONReplacer(this: any, key: string, value: unknown) {
	if (typeof value === 'bigint') return value.toString();
	if (value && typeof value === 'object' &&
		'type' in value && value.type === 'Buffer'&&
		'data' in value && Array.isArray(value.data)
	) {
		return Buffer.from(value.data).toString();
	}
	return value;
}

export type JSONStringify<T> =
	T extends number | string | boolean ? T :
	T extends null | undefined          ? null :
	T extends bigint                    ? string :
	T extends Array<infer U>            ? Array<JSONStringify<U>> :
	T extends Record<string, unknown>   ? { [K in keyof T]: JSONStringify<T[K]> } :
	never