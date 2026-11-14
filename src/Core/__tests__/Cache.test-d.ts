import { constTruthyBool } from "#test-utils";
import { expectTypeOf, test } from "vitest";
import { Duration } from "../../Types/Duration.ts";
import { Cache } from "../Cache.ts";
import { Deferred } from "../Deferred.ts";
import { Maybe } from "../Maybe.ts";
import { Result } from "../Result.ts";
import { Task } from "../Task.ts";

type LookupError = { readonly kind: "NotFound"; } | { readonly kind: "Unavailable"; };
type User = { readonly id: string; readonly name: string; };

test("make: infers key, error, and value channels from the load", () => {
	const cache = Cache.make({
		load: (id: string): Deferred<Result<LookupError, User>> =>
			constTruthyBool() ? Task.Result.make.ok({ id, name: "Ada" })() : Task.Result.make.err({ kind: "NotFound" })(),
		ttl: Duration.minutes(5),
		staleWhileRevalidate: Duration.minutes(1),
		maxSize: 500,
	});

	expectTypeOf(cache).toEqualTypeOf<Cache<string, LookupError, User>>();
	expectTypeOf(cache.load("u_1")).toEqualTypeOf<Deferred<Result<LookupError, User>>>();

	const controller = new AbortController();
	// @ts-expect-error — load takes only a key; a lookup is not cancellable
	cache.load("u_1", controller.signal);
	expectTypeOf(cache.peek("u_1")).toEqualTypeOf<Maybe<User>>();
	expectTypeOf(cache.invalidate("u_1")).toEqualTypeOf<void>();
	expectTypeOf(cache.clear()).toEqualTypeOf<void>();
	expectTypeOf(cache.flush()).toEqualTypeOf<Deferred<void>>();
	expectTypeOf(cache.size()).toEqualTypeOf<number>();

	// @ts-expect-error — lookups are keyed by the inferred key type
	cache.load(42);

	// @ts-expect-error — ttl is required
	Cache.make({ load: (id: string) => Task.Result.make.ok({ id, name: "Ada" })() });

	// @ts-expect-error — load must return a started deferred, not a lazy task
	Cache.make({ load: (id: string) => Task.Result.make.ok(id), ttl: Duration.seconds(1) });
});

test("make: keyBy infers a serialized key without changing the cache's key channel", () => {
	type Request = { readonly id: string; readonly attempt: number; };

	const cache = Cache.make({
		load: (request: Request): Deferred<Result<LookupError, User>> =>
			Task.Result.make.ok({ id: request.id, name: "Ada" })(),
		ttl: Duration.seconds(30),
		keyBy: (request) => request.id,
	});

	expectTypeOf(cache).toEqualTypeOf<Cache<Request, LookupError, User>>();
	expectTypeOf(cache.load({ id: "u_1", attempt: 1 })).toEqualTypeOf<Deferred<Result<LookupError, User>>>();
});

test("Config: accepts explicit channels and defaults the serialized key to the key", () => {
	const config: Cache.Options<string, LookupError, User> = {
		load: (id) => Task.Result.make.ok({ id, name: "Ada" })(),
		ttl: Duration.seconds(30),
	};

	expectTypeOf(Cache.make(config)).toEqualTypeOf<Cache<string, LookupError, User>>();
});

test("Cache: error and value channels are covariant", () => {
	const narrow = Cache.make({
		load: (_id: string): Deferred<Result<"NotFound", User>> => Task.Result.make.err("NotFound")(),
		ttl: Duration.seconds(10),
	});

	const wide: Cache<string, "NotFound" | "Unavailable", User> = narrow;
	expectTypeOf(wide).toEqualTypeOf<Cache<string, "NotFound" | "Unavailable", User>>();
});
