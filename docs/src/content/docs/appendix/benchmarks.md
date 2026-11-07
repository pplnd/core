---
title: Performance and benchmarks
description: What curried calls cost and which data helpers beat native methods.
---

Core containers (`Maybe`, `Result`, `Task`, `RemoteData`) wrap values in `{ kind, value }` or
`{ kind, error }` objects. JavaScript has no built-in equivalent to a typed error channel, so every
`Ok` or `Some` allocates one small object that `throw` or `null` would not.

Data modules (`Arr`, `Rec`, `Dict`, `Num`, `Str`, `Uniq`) do work that JavaScript already has
methods for: mapping arrays and splitting strings. The relevant comparison is
`pipe(items, Arr.filter(fn))` against `items.filter(fn)`.

## Currying overhead and loop savings

Writing `pipe(users, Arr.filter(isActive))` allocates a curried wrapper before the loop runs. The
wrapper adds one call. Whether the total is cheaper than the native method depends on the loop
inside.

Native `Array.prototype.filter`, `Array.prototype.flatMap`, and `Array.prototype.map` follow the
full ECMAScript specification, including sparse-array checks and generic callback dispatch. An
indexed `for` loop over a dense array skips those checks.

## Techniques used in the data modules

### Indexed loops instead of array callbacks

The shortest implementation of `Arr.filter` is `items.filter(predicate)`. On 10,000 numbers it takes
about 77 microseconds. An index loop that pre-allocates the input length, writes matches by index,
and truncates the result takes about 20 microseconds.

`Arr.flatMap` has the same gap: about 60 microseconds with a loop that pushes into a result array,
against 279 microseconds for native `.flatMap()`. For `.every()` and `.some()` over 10,000 elements
that all pass, an index loop takes 5.7 microseconds on average against 13.6 microseconds for the
native methods. The loop also avoids the native methods' occasional tail spikes.

### Indexed reducers

`Array.prototype.reduce` dispatches a generic callback per element and cannot be inlined the way an
indexed loop can. `Arr.reduce` and `Arr.NonEmpty.reduce` accumulate in an indexed `for` loop: about
8 microseconds on 10,000 numbers against about 52 microseconds for `data.reduce`. `Dict.reduce`
iterates `dict.values()`; destructuring `[key, value]` pairs allocates one array per entry, which
takes 44 microseconds on 10,000 entries against 21.

### Pre-allocating the result array

When the output length is known at the start, as in `Arr.map`, `Arr.scan`, `Arr.zip`,
`Arr.traverse`, and `Num.range`, allocating with `new Array(n)` and writing `result[i]` avoids
growing the backing store.

On 10,000 numbers, `Arr.scan` with a pre-allocated array takes 10.5 microseconds against 26
microseconds for a `push` loop. `Arr.zip` falls from 57 microseconds with `push` to 38 microseconds
with pre-allocation.

The filtering combinators cannot know their output length, so they pre-allocate the input length,
write survivors by index, and truncate with `result.length = count`. On 10,000 numbers the
pre-allocated forms measure 29 microseconds for `Arr.filter` and 36 for `Arr.filterMap`;
`Arr.partition` writes both groups into pre-allocated buffers and takes 31. `Arr.intersperse` knows
its exact output length, `2n - 1`, and fills it directly: 34 microseconds. Truncation releases the
unused backing store, so the larger temporary allocation is not retained.

`Arr.takeWhile` counts the matching prefix and copies it with `.slice()`, which runs in C++: 5.6
microseconds on 10,000 numbers against 17 for a `push` loop.

The raw pre-allocated `Arr.map` loop takes 10 microseconds on 10,000 numbers against 42 to 48
microseconds for `data.map(fn)`. Through `pipe(data, Arr.map(fn))` the curried wrapper prevents V8
from inlining the callback and the mean rises to 52 microseconds. Its 75th percentile (52
microseconds) still beats native `.map()` (63 microseconds). At 100 elements both take about 0.1
microseconds.

### Intermediate key/value arrays

`Object.entries(record)` allocates a two-element `[key, value]` array for every property before the
loop starts. `Object.values(record)` allocates a second full array to read values in key order.
Reading `Object.keys` once and indexing the record avoids both allocations.

On a 100-key record, `Rec.map` takes 2.6 microseconds against 5.8 microseconds for
`Object.fromEntries(Object.entries(rec).map(...))`. On 10,000 keys, `Rec.compact` takes 1.09
milliseconds against 1.97 milliseconds for a `for...of Object.entries` loop, and `Rec.mapKeys` takes
1.82 milliseconds against 2.75 milliseconds.

The value-only combinators show the cost of the second array. `Rec.map` takes 2.08 milliseconds when
the loop reads values through the keys array; a separate `Object.values` pass raises it to 3.43.
`Rec.filter` takes 1.36 milliseconds against 2.75. `Rec.groupBy` uses an `Array.isArray` group
discriminator in place of an `Object.hasOwn` check per item, which brings its 10,000-item run to 225
microseconds against 360.

`Dict.from.record` applies the same pattern: `Object.keys` once and `Map.set` per key avoids the
tuple array that `new Map(Object.entries(record))` materialises. On 10,000 keys it takes 1.5
milliseconds against 2.8. `Dict.entries` pre-allocates `dict.size` and fills the array by index;
`Array.from(dict.entries())` leaves the result length unknown and grows it, taking 173 microseconds
against 49.

### Contiguous copies through built-ins

A JavaScript `for` loop cannot beat the engine at copying a contiguous slice. V8 implements
`Array.prototype.slice` in C++, so `Arr.take`, `Arr.drop`, and `Arr.splitAt` call `.slice()`
directly.

On 10,000 elements, `Arr.take` through `.slice()` takes 0.8 microseconds against 4.7 microseconds
for a pre-allocated JavaScript copy. `Arr.drop` takes 0.7 against 5.1. `Arr.reverse` copies with
`.slice()` and reverses that copy in place, which avoids a second full copy from spreading the input
first: about 9 microseconds against 12.

### Single-pass regex scans

`Str.words` scans for non-whitespace runs with `text.match(/\S+/g) ?? []`. On a 10,000-word
paragraph this takes 176 microseconds; `text.trim().split(/\s+/).filter(Boolean)` allocates a
trimmed copy, a split array, and a filtered array, and takes 348.

## Cases where the library is slower

`Arr.groupBy` stays at about 65 microseconds on 10,000 items, level with a handwritten loop. It
keeps the `__proto__` guard and uses an `Array.isArray` group discriminator.

For application arrays of a few dozen or a few hundred items, these differences are measured in
nanoseconds. In a hot loop over tens of thousands of items, write the loop directly.

## Running the benchmarks

Each module has a `__bench__` directory that compares the `pipelined` function with the native
equivalent on the same input. Most benchmarks use 10,000 elements; `Rec`, `Dict`, `Uniq`, and
`Arr.map` also use 100.

`pnpm bench` is exploratory. A comparison samples for about a second. Very fast comparisons also
take time to report tens of millions of samples, and a full pass takes tens of minutes. The harness
cannot resolve differences below about 30 nanoseconds per operation, so the suite omits those
comparisons. `Dict` and `Uniq` fixtures are generated once with
`fc.sample(arbitrary, { numRuns: 1, seed: 42 })`, so reruns measure identical data. Benchmark files
are part of `pnpm typecheck`; a renamed library export fails verification instead of throwing during
an exploratory run.

Vitest's module runner wraps module exports in getters. Calls that reach a module namespace inside
the library, such as `Maybe.make.some` in `Dict.lookup`, pay that overhead in exploratory runs while
native baselines do not, so library-versus-native ratios are conservative. `pnpm bench:ci` runs in
plain Node against the built bundle and does not pay it.

The regression check is `pnpm bench:ci`. It runs `scripts/bench-gate.ts`, which measures the
repaired paths against their documented loop, asserts both sides return equal results, and compares
the current/reference ratio with the budgets in `benchmarks/baseline.json`. The gate covers
`Arr.reduce`, `Arr.NonEmpty.reduce`, `Arr.reverse`, `Arr.filter`, `Arr.filterMap`, `Arr.partition`,
`Arr.partitionMap`, `Arr.takeWhile`, `Arr.intersperse`, `Rec.map`, `Rec.filter`, `Rec.mapWithKey`,
`Rec.filterMap`, `Rec.groupBy`, `Rec.mergeWith`, `Dict.reduce`, `Dict.from.record`, `Dict.entries`,
`Str.words`, and `Num.format`. It takes a few seconds and runs in the verification workflow.

```sh
pnpm bench:ci            # ratio gate, exits non-zero on a regression
pnpm bench               # exploratory comparisons
```

To record new ratios after an intentional change:

```sh
pnpm build && node --expose-gc scripts/bench-gate.ts --update
```

### Comparison correctness

Each data comparison calls `assertEquivalent` (`src/Data/__bench__/equivalence.ts`) once outside the
timed section and fails when the two results differ, so a semantic change on either side cannot
produce a passing benchmark. Comparisons whose sides intentionally compute different work are marked
overhead-only in the source: the `EventEmitter` throughput comparison and the keyed `Op.interpret`
transition, which is measured against a direct outcome update rather than a second keyed engine.

The `Op` scenarios measure three engine paths. A full `restartable` execution runs against a
hand-written manager that performs the same transitions, so the ratio isolates the engine rather
than the task; a dropped `once` call measures the cost of rejecting a terminal call; and a keyed
transition measures a run while 128 keys hold settled state. The first two assert outcome
equivalence on both sides.

### Coverage contract

Every public leaf of a module with a `__bench__` file is either referenced by a benchmark (or by
`scripts/bench-gate.ts`) or listed in `benchmarks/coverage.json` as out of scope.
`node scripts/bench-coverage.ts` enforces this as part of `pnpm bench:ci`; adding a public function
without a benchmark fails the gate until it is measured or listed.

| Module | Benchmarked leaves |
| :----- | -----------------: |
| `Arr`  |            21 / 73 |
| `Rec`  |             9 / 35 |
| `Dict` |            13 / 40 |
| `Uniq` |             9 / 24 |
| `Str`  |             6 / 25 |
| `Num`  |             5 / 29 |

Most out-of-scope entries are O(1) accessors such as `Arr.head` and `Dict.has`, or small helpers
that do not warrant a dedicated benchmark. The full list is in `benchmarks/coverage.json`. `BigNum`,
`Bool`, and `Json` have no benchmark suite and are not assessed.

## Measurement environment

Apple M1 Pro (arm64, macOS), Node.js 24.21 to 26.10 (V8 13.6 to 14.6). The V8 version and the
machine change absolute timings; treat the printed microseconds as indicative. The ratio budgets
enforced by `pnpm bench:ci` are the contract.

## Interpreting micro-benchmarks

A micro-benchmark runs one function in a tight loop with hot instruction caches and predictable
branches. It compares two implementations on one machine. It does not predict request latency, where
most time goes to I/O or serialization.

Use the suite to detect a regression in a data helper against its native baseline. Do not use it as
a production latency target.
