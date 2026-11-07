import { flow, pipe } from "#composition";
import { test } from "vitest";
import { assertEquivalent } from "../../__bench__/equivalence.ts";

// Vitest's module runner resolves imported bindings through getters on every access.
const pipeFn = pipe;
const flowFn = flow;

const inc = (n: number) => n + 1;
const addTwo = (n: number) => n + 2;
const addThree = (n: number) => n + 3;
const mask = (n: number) => n ^ 1;

// A rotating input keeps V8 from constant-folding a fixed pipeline.
const inputs = Array.from({ length: 1024 }, (_, i) => i);
let cursor = 0;
const nextInput = () => {
	cursor = (cursor + 1) & 1023;
	return inputs[cursor];
};

const pipe3 = (n: number) => pipeFn(n, inc, addTwo, addThree);
const direct3 = (n: number) => addThree(addTwo(inc(n)));

const pipe5 = (n: number) => pipeFn(n, inc, addTwo, addThree, mask, inc);
const direct5 = (n: number) => inc(mask(addThree(addTwo(inc(n)))));

const pipe10 = (n: number) => pipeFn(n, inc, addTwo, addThree, mask, inc, addTwo, addThree, mask, inc, addTwo);
const direct10 = (n: number) => addTwo(inc(mask(addThree(addTwo(inc(mask(addThree(addTwo(inc(n))))))))));

const restCompose = (...fns: readonly ((n: number) => number)[]) => (n: number) => {
	let result = n;
	for (let i = 0; i < fns.length; i++) {
		result = fns[i](result);
	}
	return result;
};
const loop3 = restCompose(inc, addTwo, addThree);

const flow3 = flowFn(inc, addTwo, addThree);

test("pipe-steps", async ({ bench }) => {
	const input = nextInput();
	assertEquivalent("pipe-steps/3", pipe3(input), direct3(input));
	assertEquivalent("pipe-steps/5", pipe5(input), direct5(input));
	assertEquivalent("pipe-steps/10", pipe10(input), direct10(input));
	assertEquivalent("pipe-steps/loop", loop3(input), direct3(input));
	await bench.compare(
		bench("1. (current) pipe 3 steps", () => pipe3(nextInput())),
		bench("2. pipe 5 steps", () => pipe5(nextInput())),
		bench("3. pipe 10 steps", () => pipe10(nextInput())),
		bench("4. direct nesting 3 steps", () => direct3(nextInput())),
		bench("5. rest-parameter loop 3 steps", () => loop3(nextInput())),
	);
});

test("flow-build-and-call", async ({ bench }) => {
	const input = nextInput();
	assertEquivalent("flow-call/3", flow3(input), direct3(input));
	await bench.compare(
		bench("1. (current) flow 3 steps call", () => flow3(nextInput())),
		bench("2. direct nesting 3 steps call", () => direct3(nextInput())),
		bench("3. (current) flow 3 steps build", () => flowFn(inc, addTwo, addThree)),
		bench("4. rest-composed 3 steps build", () => restCompose(inc, addTwo, addThree)),
	);
});
