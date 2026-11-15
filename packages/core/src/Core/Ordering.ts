/**
 * A function that orders two values of type `A`. Returns a negative number when `first` comes before
 * `second`, a positive number when `first` comes after `second`, and `0` when they are equal.
 *
 * Compatible with `Array.prototype.sort` and `Arr.sortWith`.
 *
 * @example
 * ```ts
 * type Employee = { name: string; salary: number };
 *
 * const byName   = pipe(Ordering.string, Ordering.by((e: Employee) => e.name));
 * const bySalary = pipe(Ordering.number, Ordering.by((e: Employee) => e.salary));
 *
 * pipe(employees, Arr.sortWith(pipe(byName, Ordering.thenBy(bySalary))));
 * ```
 */
export type Ordering<A> = (first: A, second: A) => number;

const stringOrd: Ordering<string> = (first, second) => (first < second ? -1 : (first > second ? 1 : 0));
const numberOrd: Ordering<number> = (first, second) => {
	const firstNaN = Number.isNaN(first);
	const secondNaN = Number.isNaN(second);
	if (firstNaN || secondNaN) {
		return firstNaN && secondNaN ? 0 : firstNaN ? 1 : -1;
	}
	return first < second ? -1 : (first > second ? 1 : 0);
};
const dateOrd: Ordering<Date> = (first, second) => numberOrd(first.getTime(), second.getTime());

export const Ordering = {
	/**
	 * Alphabetical ordering for strings.
	 *
	 * @see {@link Ordering.number} for numeric ordering.
	 *
	 * @example
	 * ```ts
	 * Ordering.string("apple", "banana"); // -1
	 * ```
	 */
	string: stringOrd,

	/**
	 * Numeric ordering returning `-1`, `0`, or `1`. `NaN` sorts after all valid numbers.
	 *
	 * @see {@link Ordering.date} for chronological ordering.
	 *
	 * @example
	 * ```ts
	 * pipe([3, 1, 2], Arr.sortWith(Ordering.number)); // [1, 2, 3]
	 * ```
	 */
	number: numberOrd,

	/**
	 * Ordering for `Date` values by numeric time value returning `-1`, `0`, or `1`.
	 * Invalid dates sort after all valid dates.
	 *
	 * @see {@link Ordering.number} for numeric ordering.
	 *
	 * @example
	 * ```ts
	 * pipe(dates, Arr.sortWith(Ordering.date)); // earliest first
	 * ```
	 */
	date: dateOrd,

	/**
	 * Flips the direction of an ordering.
	 *
	 * @see {@link Ordering.thenBy} to combine orderings with tiebreakers.
	 *
	 * @example
	 * ```ts
	 * pipe([3, 1, 2], Arr.sortWith(Ordering.reverse(Ordering.number))); // [3, 2, 1]
	 * ```
	 */
	reverse: <A>(ordering: Ordering<A>): Ordering<A> => (first, second) => ordering(second, first),

	/**
	 * Chains two orderings: the second is used only when the first returns `0`.
	 * Data-last: the first ordering is the data being piped.
	 *
	 * @see {@link Ordering.byFields} to combine multiple orderings from an array.
	 * @see {@link Ordering.reverse} to invert an ordering.
	 *
	 * @example
	 * ```ts
	 * const byDeptThenSalary = pipe(byDept, Ordering.thenBy(bySalary));
	 * ```
	 */
	thenBy: <A>(other: Ordering<A>) => <B extends A>(ordering: Ordering<B>): Ordering<B> => (first, second) => {
		const result = ordering(first, second);
		return result !== 0 ? result : other(first, second);
	},

	/**
	 * Adapts an ordering for type `A` into an ordering for type `B` by extracting a field.
	 * Read as "ordering by this field": `pipe(Ordering.number, Ordering.by(p => p.price))`.
	 *
	 * @see {@link Ordering.thenBy} to chain projected orderings.
	 * @see {@link Ordering.byFields} to combine multiple projected orderings.
	 *
	 * @example
	 * ```ts
	 * type Product = { name: string; price: number };
	 * const byPrice = pipe(Ordering.number, Ordering.by((p: Product) => p.price));
	 * pipe(products, Arr.sortWith(byPrice));
	 * ```
	 */
	by: <A, B>(extract: (value: B) => A) => (ordering: Ordering<A>): Ordering<B> => (first, second) =>
		ordering(extract(first), extract(second)),

	/**
	 * Combines a list of orderings into a single composite comparator.
	 * Evaluates each ordering in sequence until a non-zero comparison result is found.
	 *
	 * @see {@link Ordering.thenBy} to chain two orderings.
	 *
	 * @example
	 * ```ts
	 * const byName = pipe(Ordering.string, Ordering.by((u: User) => u.name));
	 * const byAge  = pipe(Ordering.number, Ordering.by((u: User) => u.age));
	 * const sortUsers = Ordering.byFields([byName, byAge]);
	 * ```
	 */
	byFields: <A>(orderings: readonly Ordering<A>[]): Ordering<A> => (first, second) => {
		for (let i = 0; i < orderings.length; i++) {
			const res = orderings[i](first, second);
			if (res !== 0) {
				return res;
			}
		}
		return 0;
	},

	/**
	 * Derives a lexicographical tuple ordering from positional `Ordering` comparators.
	 *
	 * @see {@link Ordering.byFields} for ordering homogenous values with multiple comparators.
	 *
	 * @example
	 * ```ts
	 * const pairOrd = Ordering.tuple(Ordering.string, Ordering.number);
	 * pairOrd(["a", 1], ["a", 2]); // negative
	 * ```
	 */
	tuple:
		<T extends readonly unknown[]>(...orderings: { [K in keyof T]: Ordering<T[K]>; }): Ordering<T> => (first, second) => {
			const len = Math.min(orderings.length, first.length, second.length);
			for (let i = 0; i < len; i++) {
				const res = orderings[i](first[i], second[i]);
				if (res !== 0) {
					return res;
				}
			}
			return first.length - second.length;
		},
};
