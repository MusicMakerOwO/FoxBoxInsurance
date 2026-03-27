/** Bigint is an alias for string with the exception it also checks the string contents */
export type PrimitiveType = 'string' | 'number' | 'boolean';
export type NullableType  = `${PrimitiveType}?`;
export type FieldType     = PrimitiveType | NullableType;

// Map blueprint string literals to their actual types
type BlueprintTypeMap = {
	'string'  : string
	'number'  : number
	'boolean' : boolean

	'string?'  : string | null
	'number?'  : number | null
	'boolean?' : boolean | null
}

// Map an entire blueprint object to its inferred shape
type InferBlueprint<B extends JSONBlueprint> = {
	[K in keyof B]: BlueprintTypeMap[ B[K] ]
}

export type JSONBlueprint = Record<string, FieldType>;

export function ObjectKeysMatch(x: Record<string, unknown>, y: Record<string, unknown>) {
	// the sort ensures that insertion order is irrelevant
	const xKeys = Object.keys(x).sort((a, b) => a.localeCompare(b)).join(':');
	const yKeys = Object.keys(y).sort((a, b) => a.localeCompare(b)).join(':');
	return xKeys === yKeys;
}

export function CompareBlueprint<B extends JSONBlueprint>(
	data: Record<string, unknown>,
	blueprint: B
): data is InferBlueprint<B> {
	if ( ! ObjectKeysMatch(data, blueprint) ) return false;

	for (const key of Object.keys(blueprint) as (keyof B)[]) {
		const blueprintType = blueprint[key] as FieldType;
		const [expectedType, valueOptional] = blueprintType.endsWith('?')
			? [ blueprintType.replace('?', '') as PrimitiveType, true]
			: [ blueprintType as PrimitiveType, false ];

		const value: unknown = (data as Record<keyof B, unknown>)[key];

		if (value === null) {
			if (!valueOptional) return false;
			continue; // allow null for optional fields
		}

		if (typeof value !== expectedType) return false;
	}

	return true;
}