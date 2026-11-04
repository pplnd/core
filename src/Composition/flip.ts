/**
 * Flips the order of arguments for a curried binary function.
 * Converts a data-last function to data-first.
 *
 * The function must have a concrete two-stage type. Generic container helpers such as
 * `Maybe.map` are higher-kinded and cannot be flipped directly; wrap them in a concrete
 * function first.
 *
 * @example
 * ```ts
 * const prepend = (prefix: string) => (text: string) => prefix + text;
 * const append = flip(prepend);
 *
 * prepend("Hello, ")("World"); // "Hello, World"
 * append("World")("Hello, ");  // "Hello, World"
 * ```
 *
 * @see {@link uncurry} for converting curried functions to multi-argument functions
 */
export const flip = <A, B, C>(f: (a: A) => (b: B) => C) => (b: B) => (a: A): C => f(a)(b);
