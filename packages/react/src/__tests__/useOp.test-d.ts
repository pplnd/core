import { Deferred, Op } from "@pplnd/core";
import { expectTypeOf, test } from "vitest";
import { useOp, type UseOpResult } from "../useOp.ts";

declare const manager: Op.Manager<[string], string, number, Op.State<string, number>>;
declare const settledManager: Op.Manager<[string], string, number, Op.Err<string>>;
declare const result: UseOpResult<[string], string, number, Op.State<string, number>>;

test("useOp: binds the manager's state union and forwarding callbacks", () => {
	expectTypeOf(useOp(manager)).toEqualTypeOf<UseOpResult<[string], string, number, Op.State<string, number>>>();
	expectTypeOf(result.state).toEqualTypeOf<Op.State<string, number>>();
	expectTypeOf(result.abort).toEqualTypeOf<() => void>();
	expectTypeOf(result.reset).toEqualTypeOf<() => void>();
});

test("useOp: run forwards the manager's args and settles with its outcome", () => {
	expectTypeOf(result.run).toEqualTypeOf<
		(
			...args: [string]
		) => Deferred<Exclude<Op.State<string, number>, Op.Idle | Op.Pending | Op.Queued | Op.Retrying<string>>>
	>();
});

test("useOp: a narrowed manager narrows the bound state", () => {
	expectTypeOf(useOp(settledManager).state).toEqualTypeOf<Op.Err<string>>();
});

test("useOp: run's settled outcome excludes the in-flight variants", () => {
	const { run } = useOp(manager);
	expectTypeOf(run("u_1")).toEqualTypeOf<Deferred<Op.Outcome<string, number>>>();
});

test("useOp: rejects non-manager inputs", () => {
	const notAManager: { readonly state: null; } = { state: null };
	expectTypeOf(useOp(manager).state).toEqualTypeOf<Op.State<string, number>>();
	// @ts-expect-error an object without the manager surface (run/abort/subscribe/reset/state) is rejected
	useOp(notAManager);
});
