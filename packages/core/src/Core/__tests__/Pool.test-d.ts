import { expectTypeOf, test } from "vitest";
import { Aborted } from "../Aborted.ts";
import { Deferred } from "../Deferred.ts";
import { Pool } from "../Pool.ts";
import { type Result } from "../Result.ts";
import { Task } from "../Task.ts";

test("make: infers the error and value channels from the acquire and destroy tasks", () => {
	const pool = Pool.make<"offline", string>({
		acquire: Task.Result.tryCatch(() => Promise.resolve("conn"), { onError: () => "offline" as const }),
		destroy: (item) => Task.tryCatch(() => Promise.resolve(item), { onError: () => {} }),
		maxSize: 2,
	});
	expectTypeOf(pool).toEqualTypeOf<Pool<"offline", string>>();
});

test("acquire: settles with the pool error union and an exclusive lease", async () => {
	const pool = Pool.make<"offline", string>({
		acquire: Task.Result.tryCatch(() => Promise.resolve("conn"), { onError: () => "offline" as const }),
		destroy: (item) => Task.tryCatch(() => Promise.resolve(item), { onError: () => {} }),
		maxSize: 2,
	});
	const outcome = pool.acquire();
	expectTypeOf(outcome).toEqualTypeOf<
		Deferred<Result<"offline" | Pool.Timeout | Pool.Closed | Aborted, Pool.Lease<string>>>
	>();
	const result = await outcome;
	expectTypeOf(result).toEqualTypeOf<Result<"offline" | Pool.Timeout | Pool.Closed | Aborted, Pool.Lease<string>>>();
});

test("lease: is opaque outside item and release", () => {
	expectTypeOf<Pool.Lease<string>>().toEqualTypeOf<
		{ readonly item: string; readonly release: (options?: { readonly broken?: boolean; }) => Deferred<void>; }
	>();
});

test("state: covers the three lifecycle states", () => {
	expectTypeOf<Pool.State>().toEqualTypeOf<Pool.Idle | Pool.Active | Pool.Closed>();
});

test("negative: the item factory must be a Task.Result definition", () => {
	// @ts-expect-error acquire must be a Task.Result, not a raw promise or lambda
	expectTypeOf(Pool.make({ acquire: 42, destroy: () => Task.tryCatch(() => {}, { onError: () => {} }), maxSize: 1 }))
		.toBeObject();
});
