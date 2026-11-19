import { pipe } from "#composition";
import { Op, Task } from "#core";
import { test } from "vitest";
import { assertEquivalent } from "../../__bench__/equivalence.ts";

const pipeFn = pipe;
const outcomeMake = Op.Outcome.make;
const outcomeMap = Op.Outcome.map;
const outcomeChain = Op.Outcome.chain;
const outcomeMatch = Op.Outcome.match;
const opMake = Op.make;
const opInterpret = Op.interpret;
const { tryCatch } = Task.Result;

const currentOutcomePipeline = () => {
	const outcome = outcomeMake.ok(42);
	return pipeFn(
		outcome,
		outcomeMap((x: number) => x * 2),
		outcomeChain((x: number) => outcomeMake.ok(x + 1)),
		outcomeMatch({ err: (err: unknown) => `err:${String(err)}`, nil: () => "nil", ok: (val: number) => `ok:${val}` }),
	);
};
const manualOutcomePipeline = () => {
	const outcome = outcomeMake.ok(42) as Op.Outcome<string, number>;
	const s1 = outcome.kind === "OpOk" ? outcomeMake.ok(outcome.value * 2) : outcome;
	const s2 = s1.kind === "OpOk" ? outcomeMake.ok(s1.value + 1) : s1;
	return s2.kind === "OpOk" ? `ok:${s2.value}` : s2.kind === "OpErr" ? `err:${s2.error}` : "nil";
};

// Shared by both sides of the manager comparisons, so the measured difference is
// the Op engine rather than the task.
const doubleTask = (n: number): Task.Result<string, number> =>
	tryCatch((_signal) => Promise.resolve(n * 2), { onError: String });

const op = opMake(doubleTask);

// Hand-written single-slot restartable manager performing the same observable work:
// cancel the superseded run, emit Pending, run the task, settle the caller, emit the outcome.
const makeManualRestartable = (task: typeof doubleTask) => {
	let state: Op.State<string, number> = { kind: "Idle" };
	let controller: AbortController | undefined;
	let settleCurrent: ((outcome: Op.Outcome<string, number>) => void) | undefined;

	const run = (n: number): Promise<Op.Outcome<string, number>> =>
		new Promise<Op.Outcome<string, number>>((resolve) => {
			controller?.abort();
			controller = new AbortController();
			const running = controller;
			const previous = settleCurrent;
			settleCurrent = resolve;
			previous?.(outcomeMake.nil("replaced"));
			state = { kind: "Pending" };
			task(n)(running.signal).then((result) => {
				if (controller !== running) { return; }
				const settle = settleCurrent;
				settleCurrent = undefined;
				controller = undefined;
				if (result.kind !== "Ok") { return; }
				const outcome = outcomeMake.ok(result.value);
				state = outcome;
				settle?.(outcome);
			});
		});

	return {
		run,
		get state() {
			return state;
		},
	};
};

// =============================================================================
// Scenario 1: Sync Outcome Transformations
// =============================================================================

test("op-sync-transformations", async ({ bench }) => {
	assertEquivalent("op-sync-transformations", currentOutcomePipeline(), manualOutcomePipeline());
	await bench.compare(
		bench("1. (current) Op.Outcome.map + Op.Outcome.chain + Op.Outcome.match", currentOutcomePipeline),
		bench("2. manual inline outcome checks", manualOutcomePipeline),
	);
});

// =============================================================================
// Scenario 2: Op.interpret Execution
//
// `restartable` is used on purpose: `once` settles permanently, so every call
// after the first returns DroppedNil without touching the task (the previous
// version of this benchmark measured that drop path, not execution).
// Both sides run the same `Task.Result`, so the measured difference is the
// manager engine: state emission, cancellation plumbing, and settlement.
// =============================================================================

test("op-interpret-execution", async ({ bench }) => {
	const manager = opInterpret(op, { strategy: "restartable" });
	const manual = makeManualRestartable(doubleTask);
	assertEquivalent("op-interpret-execution", await manager.run(50), await manual.run(50));

	await bench.compare(
		bench("1. Op.interpret restartable (full execution)", async () => {
			await manager.run(50);
		}),
		bench("2. hand-written equivalent manager", async () => {
			await manual.run(50);
		}),
	);
});

// =============================================================================
// Scenario 3: Dropped Runs
//
// `once` is terminal: after the first settled run every further call settles
// with DroppedNil. This measures the cost of a rejected call, which is the
// documented behavior for duplicate `once`, `exclusive`, and `keyed` runs.
// =============================================================================

test("op-dropped-run", async ({ bench }) => {
	const manager = opInterpret(op, { strategy: "once" });
	await manager.run(1);
	assertEquivalent("op-dropped-run", await manager.run(2), outcomeMake.nil("dropped"));

	await bench.compare(
		bench("1. Op.interpret once — run after settlement (DroppedNil)", async () => {
			await manager.run(50);
		}),
		bench("2. Promise.resolve of the same DroppedNil", async () => {
			await Promise.resolve(outcomeMake.nil("dropped"));
		}),
	);
});

// =============================================================================
// Scenario 4: Keyed Transitions
//
// Each keyed transition publishes a fresh snapshot of the whole per-key state
// map. With 128 settled keys the engine copies 128 entries on every run.
// Overhead-only comparison: the reference updates the outcome directly without
// the state machine, so the two sides do not compute equal work.
// =============================================================================

test("op-keyed-transition", async ({ bench }) => {
	const manager = opInterpret(op, { strategy: "keyed", keyBy: (n: number) => n, perKey: "exclusive" });
	for (let key = 0; key < 128; key++) {
		await manager.run(key);
	}

	assertEquivalent("op-keyed-transition", await manager.run(50), outcomeMake.ok(100));

	await bench.compare(
		bench("1. Op.interpret keyed — one transition with 128 settled keys", async () => {
			await manager.run(50);
		}),
		bench("2. direct outcome without the engine", async () => {
			await Promise.resolve(outcomeMake.ok(100));
		}),
	);
});
