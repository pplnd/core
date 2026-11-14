import { expect, test } from "vitest";
import { Task } from "../../Core/Task.ts";
import { uncurry } from "../uncurry.ts";

// --- uncurry: returned functions are preserved ---

test("uncurry: preserves a returned thunk instead of invoking it", () => {
	const factory = (id: string) => (attempt: number) => () => `${id}:${attempt}`;
	const load = uncurry(factory)("user-1", 2);

	expect(load).toBeTypeOf("function");
	expect(load()).toBe("user-1:2");
});

test("uncurry: preserves a returned Task", async () => {
	const factory = (id: string) => (attempt: number) => Task.make(`${id}:${attempt}`);
	const load = uncurry(factory)("user-1", 2);

	expect(load).toBeTypeOf("function");
	await expect(load()).resolves.toBe("user-1:2");
});

test("uncurry: rejects an unsupported explicit arity", () => {
	const curried = (a: number) => (b: number) => a + b;
	const arity: number = 5;

	// @ts-expect-error unsupported arity is outside the public overloads
	expect(() => uncurry(curried, arity)).toThrow(/arity/iu);
});

// --- uncurry: full (a) => (b) => C ---

test("uncurry: uncurries binary arithmetic function", () => {
	const curriedAdd = (a: number) => (b: number) => a + b;
	const add = uncurry(curriedAdd);
	expect(add(3, 4)).toBe(7);
});

test("uncurry: uncurries binary string concatenation", () => {
	const curriedConcat = (a: string) => (b: string) => a + b;
	const concat = uncurry(curriedConcat);
	expect(concat("Hello, ", "World")).toBe("Hello, World");
});

test("uncurry: uncurries functions with distinct argument types", () => {
	const curriedRepeat = (s: string) => (n: number) => s.repeat(n);
	const repeat = uncurry(curriedRepeat);
	expect(repeat("ab", 3)).toBe("ababab");
});

// --- uncurry (3-argument) ---

test("uncurry: uncurries 3-argument function", () => {
	const curried = (a: number) => (b: number) => (c: number) => a + b + c;
	const flat = uncurry(curried, 3);
	expect(flat(1, 2, 3)).toBe(6);
});

test("uncurry: uncurries ternary string formatting function", () => {
	const curried = (first: string) => (middle: string) => (last: string) => `${first} ${middle} ${last}`;
	const format = uncurry(curried, 3);
	expect(format("John", "Q", "Doe")).toBe("John Q Doe");
});

test("uncurry: uncurries functions with mixed argument types", () => {
	const curried = (name: string) => (age: number) => (active: boolean) =>
		`${name} is ${age} and ${active ? "active" : "inactive"}`;
	const describe = uncurry(curried, 3);
	expect(describe("Alice", 30, true)).toBe("Alice is 30 and active");
});

// --- uncurry (4-argument) ---

test("uncurry: uncurries 4-argument function", () => {
	const curried = (a: number) => (b: number) => (c: number) => (d: number) => a + b + c + d;
	const flat = uncurry(curried, 4);
	expect(flat(1, 2, 3, 4)).toBe(10);
});

test("uncurry: uncurries 4-argument string formatting function", () => {
	const curried = (a: string) => (b: string) => (c: string) => (d: string) => `${a}-${b}-${c}-${d}`;
	const format = uncurry(curried, 4);
	expect(format("A", "B", "C", "D")).toBe("A-B-C-D");
});

test("uncurry: uncurries 4-argument multiplication function", () => {
	const curried = (a: number) => (b: number) => (c: number) => (d: number) => a * b * c * d;
	const multiply = uncurry(curried, 4);
	expect(multiply(2, 3, 4, 5)).toBe(120);
});
