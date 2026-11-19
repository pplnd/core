import fc from "fast-check";
import { expect, test } from "vitest";
import { Result } from "../Result.ts";
import { Task } from "../Task.ts";
import { Transaction } from "../Transaction.ts";

test("rollback: executes in strict LIFO order for any failure index", async () => {
	await fc.assert(
		fc.asyncProperty(fc.integer({ min: 1, max: 7 }), async (stepCount) => {
			const failIndex = Math.floor(Math.random() * stepCount);
			const executedForward: number[] = [];
			const executedUndo: number[] = [];

			const steps: Transaction.AnyStep<void>[] = [];

			for (let i = 0; i < stepCount; i++) {
				const idx = i;
				steps.push(Transaction.step(`s_${idx}`, () => {
					executedForward.push(idx);
					if (idx === failIndex) {
						return Task.Result.make.err(`fail_${idx}`);
					}
					return Task.Result.make.ok(`val_${idx}`);
				}, () => {
					executedUndo.push(idx);
					return Task.Result.make.ok(undefined);
				}));
			}

			const tx = Transaction.make(...steps);
			const outcome = await Transaction.run()(tx);

			expect(outcome).toStrictEqual(
				Result.make.err({
					kind: "TransactionFailure",
					stepId: `s_${failIndex}`,
					error: `fail_${failIndex}`,
					undoErrors: [],
				}),
			);

			const expectedForward = Array.from({ length: failIndex + 1 }, (_, i) => i);
			expect(executedForward).toStrictEqual(expectedForward);

			const expectedUndo = Array.from({ length: failIndex }, (_, i) => failIndex - 1 - i);
			expect(executedUndo).toStrictEqual(expectedUndo);
		}),
		{ numRuns: 50 },
	);
});

test("run: preserves all-or-nothing conservation law", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.array(fc.record({ id: fc.stringMatching(/^[a-z]{3,8}$/u), val: fc.integer() }), { minLength: 1, maxLength: 6 }),
			async (stepDefs) => {
				const seen = new Set<string>();
				const uniqueSteps: Array<{ id: string; val: number; }> = [];
				for (const s of stepDefs) {
					if (!seen.has(s.id) && s.id !== "initial") {
						seen.add(s.id);
						uniqueSteps.push(s);
					}
				}

				if (uniqueSteps.length === 0) {
					return;
				}

				let undoCount = 0;
				const steps: Transaction.AnyStep<void>[] = [];
				const expectedAcc: Record<string, number> = {};

				const makeStepUndo = () => () => {
					undoCount++;
					return Task.Result.make.ok(undefined);
				};

				for (let i = 0; i < uniqueSteps.length; i++) {
					const step = uniqueSteps[i];
					expectedAcc[step.id] = step.val;
					steps.push(Transaction.step(step.id, () => Task.Result.make.ok(step.val), makeStepUndo()));
				}

				const tx = Transaction.make(...steps);
				const outcome = await Transaction.run()(tx);

				expect(outcome).toStrictEqual(Result.make.ok(expectedAcc));
				expect(undoCount).toBe(0);
			},
		),
		{ numRuns: 30 },
	);
});

test("rollback: best-effort drain guarantees every completed undo runs despite individual errors", async () => {
	await fc.assert(
		fc.asyncProperty(fc.integer({ min: 2, max: 6 }), async (stepCount) => {
			const failIndex = stepCount - 1;
			const undosAttempted: number[] = [];

			const steps: Transaction.AnyStep<void>[] = [];

			for (let i = 0; i < stepCount; i++) {
				const idx = i;
				steps.push(Transaction.step(`step_${idx}`, () => {
					if (idx === failIndex) {
						return Task.Result.make.err("final_step_failed");
					}
					return Task.Result.make.ok(idx);
				}, () => {
					undosAttempted.push(idx);
					if (idx % 3 === 0) {
						return Task.Result.make.err(`err_undo_${idx}`);
					}
					if (idx % 3 === 1) {
						return Task.Result.make.err(`err_undo_${idx}`);
					}
					return Task.Result.make.ok(undefined);
				}));
			}

			const tx = Transaction.make(...steps);
			const outcome = await Transaction.run()(tx);

			expect(Result.is.err(outcome)).toBe(true);
			expect(undosAttempted).toHaveLength(failIndex);

			const expectedUndos = Array.from({ length: failIndex }, (_, i) => failIndex - 1 - i);
			expect(undosAttempted).toStrictEqual(expectedUndos);
		}),
		{ numRuns: 30 },
	);
});
