import fc from "fast-check";
import { expect, test } from "vitest";
import { Duration } from "../../Types/Duration.ts";
import { Cache } from "../Cache.ts";
import { Deferred } from "../Deferred.ts";
import { Result } from "../Result.ts";

test("property: a stored value is reused for every lookup within its ttl", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 20 }),
			async (keys) => {
				const calls: string[] = [];
				const cache = Cache.make<string, never, number>({
					load: (key) => {
						calls.push(key);
						return Deferred.from.Promise(globalThis.Promise.resolve(Result.make.ok(key.length)));
					},
					ttl: Duration.minutes(1),
				});

				for (const key of keys) {
					const first = await cache.load(key);
					const second = await cache.load(key);
					expect(first).toStrictEqual(Result.make.ok(key.length));
					expect(second).toStrictEqual(first);
				}

				expect(calls).toHaveLength(keys.length);
				expect(cache.size()).toBe(keys.length);
			},
		),
	);
});

test("property: concurrent lookups never start more than one load per key", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.array(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 25 }),
			async (keys) => {
				const calls: string[] = [];
				const cache = Cache.make<string, never, number>({
					load: (key) => {
						calls.push(key);
						return Deferred.from.Promise(globalThis.Promise.resolve(Result.make.ok(key.length)));
					},
					ttl: Duration.minutes(1),
				});

				const results = await Promise.all(keys.map((key) => cache.load(key)));

				expect(calls).toHaveLength(new Set(keys).size);
				expect(results).toHaveLength(keys.length);
			},
		),
	);
});
