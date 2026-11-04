import { expectTypeOf, test } from "vitest";
import { pipe } from "../../Composition/pipe.ts";
import { Deferred } from "../Deferred.ts";

test("map: infers the transformed value type", () => {
	const deferred = Deferred.from.Promise(Promise.resolve(42));
	expectTypeOf(pipe(deferred, Deferred.map((n: number) => String(n)))).toEqualTypeOf<Deferred<string>>();
});

test("map: composes through pipe with a wider output", () => {
	const deferred = Deferred.from.Promise(Promise.resolve({ id: "u_1", name: "Alice" }));
	expectTypeOf(pipe(deferred, Deferred.map((user: { id: string; name: string; }) => user.id))).toEqualTypeOf<
		Deferred<string>
	>();
});

test("chain: flattens a nested Deferred", () => {
	const deferred = Deferred.from.Promise(Promise.resolve("u_1"));
	expectTypeOf(pipe(deferred, Deferred.chain((id: string) => Deferred.from.Promise(Promise.resolve(id.length)))))
		.toEqualTypeOf<Deferred<number>>();
});

test("tap: preserves the resolved value type", () => {
	const deferred = Deferred.from.Promise(Promise.resolve(10));
	expectTypeOf(pipe(deferred, Deferred.tap((n: number) => void n))).toEqualTypeOf<Deferred<number>>();
});

test("map: rejects a transform whose parameter does not match the resolved value", () => {
	const deferred = Deferred.from.Promise(Promise.resolve("text"));
	// @ts-expect-error — a Deferred<string> cannot be mapped with a number-typed transform
	expectTypeOf(pipe(deferred, Deferred.map((n: number) => n + 1))).toEqualTypeOf<Deferred<number>>();
});

test("chain: rejects a transform that returns a plain value", () => {
	const deferred = Deferred.from.Promise(Promise.resolve(1));
	// @ts-expect-error — chain requires a Deferred-returning transform, use map for plain values
	expectTypeOf(pipe(deferred, Deferred.chain((n: number) => n + 1))).toEqualTypeOf<Deferred<number>>();
});
