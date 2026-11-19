import { flowAsync, pipeAsync } from "#composition";
import { test } from "vitest";
import { assertEquivalent } from "../../__bench__/equivalence.ts";

// Vitest's module runner resolves imported bindings through getters on every access.
const pipeAsyncFn = pipeAsync;
const flowAsyncFn = flowAsync;

const tick = (n: number) => n + 1;
const asyncTick = (n: number) => Promise.resolve(n + 1);

const shippedSync = (n: number) => pipeAsyncFn(n, tick, tick, tick);
const shippedAsync = (n: number) => pipeAsyncFn(n, asyncTick, asyncTick, asyncTick);

// Rejected alternative: index the rest array instead of iterating it.
const indexedPipeAsync = async (n: number, ...fns: readonly ((x: number) => number)[]) => {
	let result: number = n;
	for (let i = 0; i < fns.length; i++) {
		result = await fns[i](result);
	}
	return result;
};
const indexed = (n: number) => indexedPipeAsync(n, tick, tick, tick);

// Headroom: unrolling the arity removes the rest array and the loop entirely.
const unrolled = async (n: number) => {
	let result = await n;
	result = await tick(result);
	result = await tick(result);
	result = await tick(result);
	return result;
};

const shippedFlowAsync = flowAsyncFn(tick, tick, tick);
const referenceFlowAsync = (...fns: readonly ((x: number) => number)[]) => async (n: number) => {
	let result: number = n;
	for (const fn of fns) {
		result = await fn(result);
	}
	return result;
};
const referenceFlowAsync3 = referenceFlowAsync(tick, tick, tick);

test("pipeAsync-steps", async ({ bench }) => {
	const input = 1;
	const expected = await shippedSync(input);
	assertEquivalent("pipeAsync-steps/indexed", await indexed(input), expected);
	assertEquivalent("pipeAsync-steps/unrolled", await unrolled(input), expected);
	assertEquivalent("pipeAsync-steps/async", await shippedAsync(input), expected);
	await bench.compare(
		bench("1. (current) pipeAsync 3 sync steps", () => shippedSync(input)),
		bench("2. indexed loop (rejected)", () => indexed(input)),
		bench("3. unrolled arity 3 (headroom)", () => unrolled(input)),
		bench("4. pipeAsync 3 async steps", () => shippedAsync(input)),
	);
});

test("flowAsync-steps", async ({ bench }) => {
	const input = 1;
	const expected = await shippedFlowAsync(input);
	assertEquivalent("flowAsync-steps/reference", await referenceFlowAsync3(input), expected);
	await bench.compare(
		bench("1. (current) flowAsync 3 steps", () => shippedFlowAsync(input)),
		bench("2. reference composition 3 steps", () => referenceFlowAsync3(input)),
	);
});
