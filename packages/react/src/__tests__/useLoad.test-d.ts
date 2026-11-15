import { RemoteData, Task } from "@pplnd/core";
import { expectTypeOf, test } from "vitest";
import { useLoad, type UseLoadOptions, type UseLoadResult } from "../useLoad.ts";

declare const load: Task.Result<string, number>;
declare const options: UseLoadOptions;
declare const result: UseLoadResult<string, number>;

test("useLoad: infers the error and value channels from the task", () => {
	expectTypeOf(useLoad(load)).toEqualTypeOf<UseLoadResult<string, number>>();
	expectTypeOf(useLoad(load, options)).toEqualTypeOf<UseLoadResult<string, number>>();
});

test("useLoad: the result exposes the RemoteData union and a reload callback", () => {
	expectTypeOf(result.state).toEqualTypeOf<RemoteData<string, number>>();
	expectTypeOf(result.reload).toEqualTypeOf<() => void>();
});

test("useLoad: deps accept any readonly array", () => {
	expectTypeOf(useLoad(load, { deps: ["user_1"] })).toEqualTypeOf<UseLoadResult<string, number>>();
	expectTypeOf(useLoad(load, { deps: [1, "user_1", true] })).toEqualTypeOf<UseLoadResult<string, number>>();
});

test("useLoad: rejects a non-task load and unknown options keys", () => {
	expectTypeOf(useLoad(load, options)).toEqualTypeOf<UseLoadResult<string, number>>();
	// @ts-expect-error a plain promise is not a re-runnable Task.Result
	useLoad(Promise.resolve(42));
	// @ts-expect-error unknown option keys are rejected
	useLoad(load, { staleTime: 1000 });
	// @ts-expect-error keepPrevious is a boolean flag, not a string
	useLoad(load, { keepPrevious: "yes" });
});
