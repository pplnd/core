type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I
	: never;
type StructInput<Fns> = UnionToIntersection<Fns[keyof Fns] extends (value: infer A) => unknown ? A : never>;
type StructOutput<Fns> = { -readonly [K in keyof Fns]: Fns[K] extends (value: any) => infer B ? B : never; };

/**
 * Builds an object by applying a record of field-level transformer functions to the input value.
 *
 * The input type is inferred from the transformer parameters, so standalone `struct({...})` works.
 * Own string and symbol keys are processed; inherited fields are ignored.
 *
 * @example
 * ```ts
 * pipe(
 *   { name: "Alice", age: 25 },
 *   struct({
 *     name: u => u.name,
 *     isAdult: u => u.age >= 18
 *   })
 * ); // { name: "Alice", isAdult: true }
 * ```
 */
export function struct<const Fns extends Record<PropertyKey, (value: any) => unknown>>(
	fields: Fns,
): (value: StructInput<Fns>) => StructOutput<Fns>;
export function struct<A, R extends object>(fields: { [K in keyof R]: (value: A) => R[K]; }): (value: A) => R;
export function struct(fields: Record<PropertyKey, (value: any) => unknown>) {
	const keys = Reflect.ownKeys(fields);
	return (value: unknown): any => {
		const result: Record<PropertyKey, unknown> = {};
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			result[key] = fields[key](value);
		}
		return result;
	};
}
