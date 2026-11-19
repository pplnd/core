import { expect, test } from "vitest";
import { pipe } from "../../Composition/pipe.ts";
import { Deferred } from "../Deferred.ts";

// --- fromPromise ---

test("from.Promise: resolves to the value of Promise", async () => {
	const d = Deferred.from.Promise(Promise.resolve(42));
	const result = await d;
	expect(result).toBe(42);
});

test("from.Promise: resolves asynchronously", async () => {
	const d = Deferred.from.Promise(new Promise<string>((resolve) => setTimeout(() => resolve("done"), 10)));
	const result = await d;
	expect(result).toBe("done");
});

// --- then is one-shot (returns void) ---

test("then: calls callback with resolved value", async () => {
	let captured: number | undefined;
	const d = Deferred.from.Promise(Promise.resolve(99));
	d.then((v) => {
		captured = v;
	});
	await d;
	expect(captured).toBe(99);
});

// --- side-effect isolation ---

test("then: executes side-effect callback when resolved", async () => {
	let called = false;
	const d = Deferred.from.Promise(Promise.resolve(42));
	d.then(() => {
		called = true;
	});
	await d;
	expect(called).toBe(true);
});

test("then: does not execute side-effect callback before resolution", () => {
	let called = false;
	let resolveFn!: (v: number) => void;
	const promise = new Promise<number>((r) => {
		resolveFn = r;
	});
	const d = Deferred.from.Promise(promise);
	d.then(() => {
		called = true;
	});
	expect(called).toBe(false);
	resolveFn(42);
});

// --- await ---

test("thenable: can be awaited in async function", async () => {
	const result = await Deferred.from.Promise(Promise.resolve("hello"));
	expect(result).toBe("hello");
});

// --- toPromise ---

test("to.Promise: resolves to Deferred value", async () => {
	const d = Deferred.from.Promise(Promise.resolve(42));
	const result = await Deferred.to.Promise(d);
	expect(result).toBe(42);
});

test("to.Promise: round-trips with from.Promise", async () => {
	const original = Promise.resolve("roundtrip");
	const result = await Deferred.to.Promise(Deferred.from.Promise(original));
	expect(result).toBe("roundtrip");
});

// --- all & race ---

test("all: combines multiple Deferreds into tuple", async () => {
	const d1 = Deferred.from.Promise(Promise.resolve(1));
	const d2 = Deferred.from.Promise(Promise.resolve("a"));
	const result = await Deferred.all([d1, d2]);
	expect(result).toStrictEqual([1, "a"]);
});

test("race: resolves with first settled Deferred", async () => {
	const d1 = Deferred.from.Promise(new Promise<number>((r) => setTimeout(() => r(1), 50)));
	const d2 = Deferred.from.Promise(new Promise<number>((r) => setTimeout(() => r(2), 5)));
	const result = await Deferred.race([d1, d2]);
	expect(result).toBe(2);
});

// --- pipe composition ---

test("pipe: composes from.Promise and to.Promise", async () => {
	const result = await pipe(Promise.resolve(42), Deferred.from.Promise, Deferred.to.Promise);
	expect(result).toBe(42);
});

test("all: composes in pipe chain", async () => {
	const result = await pipe(
		[Deferred.from.Promise(Promise.resolve("a")), Deferred.from.Promise(Promise.resolve("b"))],
		Deferred.all,
		Deferred.to.Promise,
	);
	expect(result).toStrictEqual(["a", "b"]);
});

// --- map ---

test("map: transforms the resolved value", async () => {
	const result = await pipe(Deferred.from.Promise(Promise.resolve(5)), Deferred.map((n: number) => n * 3));
	expect(result).toBe(15);
});

test("map: does not run the transform before the Deferred resolves", async () => {
	let called = false;
	let release: (value: number) => void = () => {};
	const pending = new Promise<number>((resolve) => {
		release = resolve;
	});
	const mapped = pipe(
		Deferred.from.Promise(pending),
		Deferred.map((n: number) => {
			called = true;
			return n + 1;
		}),
	);

	expect(called).toBe(false);
	release(1);
	const transformed = await mapped;
	expect(transformed).toBe(2);
	expect(called).toBe(true);
});

// --- chain ---

test("chain: sequences a Deferred-returning step", async () => {
	const result = await pipe(
		Deferred.from.Promise(Promise.resolve("user_1")),
		Deferred.chain((id: string) => Deferred.from.Promise(Promise.resolve(`orders:${id}`))),
	);
	expect(result).toBe("orders:user_1");
});

test("chain: does not start the next Deferred until the first resolves", async () => {
	let started = false;
	let release: (value: number) => void = () => {};
	const pending = new Promise<number>((resolve) => {
		release = resolve;
	});
	const chained = pipe(
		Deferred.from.Promise(pending),
		Deferred.chain((n: number) => {
			started = true;
			return Deferred.from.Promise(Promise.resolve(n * 2));
		}),
	);

	expect(started).toBe(false);
	release(3);
	const value = await chained;
	expect(value).toBe(6);
});

// --- tap ---

test("tap: observes the value and passes it through unchanged", async () => {
	let seen: number | undefined;
	const result = await pipe(
		Deferred.from.Promise(Promise.resolve(7)),
		Deferred.tap((n: number) => {
			seen = n;
		}),
	);
	expect(seen).toBe(7);
	expect(result).toBe(7);
});

test("tap: composes with map in a single pipeline", async () => {
	const order: string[] = [];
	const result = await pipe(
		Deferred.from.Promise(Promise.resolve(2)),
		Deferred.tap(() => order.push("tap")),
		Deferred.map((n: number) => n * 10),
		Deferred.tap(() => order.push("after-map")),
	);
	expect(order).toStrictEqual(["tap", "after-map"]);
	expect(result).toBe(20);
});
