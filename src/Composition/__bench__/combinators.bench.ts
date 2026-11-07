import { constant, curry, flip, identity, on, once, uncurry, unless, when } from "#composition";
import { test } from "vitest";
import { assertEquivalent } from "../../__bench__/equivalence.ts";

const isEven = (n: number) => n % 2 === 0;
const double = (n: number) => n * 2;
const byLength = on((first: number, second: number) => first - second, (text: string) => text.length);
const append = flip((prefix: string) => (text: string) => prefix + text);
const whenEven = when(isEven, double);
const unlessEven = unless(isEven, double);
const alwaysOne = constant(1);
const onceFn = once(() => 1);
const curried = curry((first: number, second: number) => first + second);
const uncurried = uncurry((first: number) => (second: number) => first + second);

test("combinator-parity", async ({ bench }) => {
	assertEquivalent("when", whenEven(4), 8);
	assertEquivalent("unless", unlessEven(4), 4);
	assertEquivalent("flip", append("ab")("cd"), "cdab");
	assertEquivalent("on", byLength("banana", "fig"), 3);
	assertEquivalent("identity", identity(7), 7);
	assertEquivalent("constant", alwaysOne(), 1);
	assertEquivalent("once", onceFn(), 1);
	assertEquivalent("curry", curried(1)(2), 3);
	assertEquivalent("uncurry", uncurried(1, 2), 3);
	await bench.compare(
		bench("1. (current) when hit", () => whenEven(4)),
		bench("2. inline conditional", () => (isEven(4) ? double(4) : 4)),
		bench("3. (current) unless hit", () => unlessEven(4)),
		bench("4. (current) flip call", () => append("cd")("ab")),
		bench("5. (current) on comparator", () => byLength("banana", "fig")),
		bench("6. (current) once after first call", () => onceFn()),
	);
});
