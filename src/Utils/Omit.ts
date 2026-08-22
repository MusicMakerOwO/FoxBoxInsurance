export function OmitKeys<T extends object, K extends keyof T>(data: T, props: K[]): Omit<T, K> {
	const result = { ...data };
	for (const key of props) {
		delete result[key];
	}
	return result;
}
