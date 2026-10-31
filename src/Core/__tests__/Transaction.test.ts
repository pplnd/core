import { expect, test } from "vitest";
import { pipe } from "../../Composition/pipe.ts";
import { Duration } from "../../Types/Duration.ts";
import { RetryPolicy } from "../../Types/RetryPolicy.ts";
import { Deferred } from "../Deferred.ts";
import { Result } from "../Result.ts";
import { Task } from "../Task.ts";
import { Transaction } from "../Transaction.ts";

// =============================================================================
// Validation & Construction
// =============================================================================

test("step: throws TypeError if config is invalid or id is empty", () => {
	const tx = Transaction.make();
	// @ts-expect-error — invalid config argument
	expect(() => Transaction.step(null)(tx)).toThrow(TypeError);
	expect(() => Transaction.step({ id: "", run: () => Task.Result.make.ok(1) })(tx)).toThrow(TypeError);

	expect(() =>
		Transaction.step({
			// @ts-expect-error — invalid id type
			id: null,
			run: () => Task.Result.make.ok(1),
		})(tx)
	).toThrow(TypeError);
});

test("step: throws TypeError if id is 'initial'", () => {
	const tx = Transaction.make();
	expect(() =>
		Transaction.step({
			// @ts-expect-error — 'initial' is reserved
			id: "initial",
			run: () => Task.Result.make.ok(1),
		})(tx)
	).toThrow(TypeError);
});

test("step: throws TypeError if run is not a function", () => {
	const tx = Transaction.make();
	expect(() =>
		Transaction.step({
			id: "s1",
			// @ts-expect-error — missing run function
			run: null,
		})(tx)
	).toThrow(TypeError);
});

test("step: throws TypeError if undo is provided but not a function", () => {
	const tx = Transaction.make();
	expect(() =>
		Transaction.step({
			id: "s1",
			run: () => Task.Result.make.ok(1),
			// @ts-expect-error — invalid undo type
			undo: "not-a-fn",
		})(tx)
	).toThrow(TypeError);
});

test("step: throws TypeError if transaction instance is invalid", () => {
	// @ts-expect-error — invalid transaction target
	expect(() => Transaction.step({ id: "s1", run: () => Task.Result.make.ok(1) })(null)).toThrow(TypeError);
});

test("step: throws Error on duplicate step id", () => {
	const tx = pipe(Transaction.make(), Transaction.step({ id: "stepA", run: () => Task.Result.make.ok(1) }));

	expect(() => Transaction.step({ id: "stepA", run: () => Task.Result.make.ok(2) })(tx)).toThrow(
		/Duplicate step id 'stepA'/,
	);
});

test("run: returns Err if transaction instance is invalid", async () => {
	// @ts-expect-error — invalid transaction target
	const outcome = await Transaction.run()({ kind: "NotTransaction" })();
	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "initial", error: expect.any(TypeError), undoErrors: [] }),
	);
});

// =============================================================================
// Forward Execution & Context Accumulation
// =============================================================================

test("forward: executes sequential steps without input and accumulates outputs", async () => {
	const order: string[] = [];

	const tx = pipe(
		Transaction.make(),
		Transaction.step({
			id: "first",
			run: () => {
				order.push("run:first");
				return Task.Result.make.ok(10);
			},
		}),
		Transaction.step({
			id: "second",
			run: (ctx) => {
				order.push(`run:second(${ctx.first})`);
				return Task.Result.make.ok(`val_${ctx.first * 2}`);
			},
		}),
	);

	const outcome = await pipe(tx, Transaction.run())();

	expect(outcome).toStrictEqual(Result.make.ok({ first: 10, second: "val_20" }));
	expect(order).toStrictEqual(["run:first", "run:second(10)"]);
});

test("forward: threads initial input and prior step outputs across all steps", async () => {
	type Input = { readonly sku: string; readonly qty: number; };

	const tx = pipe(
		Transaction.make<Input>(),
		Transaction.step({
			id: "reserve",
			run: ({ initial }) => Task.Result.make.ok({ resId: `res_${initial.sku}_${initial.qty}` }),
		}),
		Transaction.step({
			id: "charge",
			run: ({ initial, reserve }) => Task.Result.make.ok({ chargeId: `ch_${reserve.resId}`, amount: initial.qty * 50 }),
		}),
		Transaction.step({
			id: "notify",
			run: ({ initial, reserve, charge }) =>
				Task.Result.make.ok({ status: "sent", summary: `${initial.sku}: ${reserve.resId} charged ${charge.amount}` }),
		}),
	);

	const outcome = await pipe(tx, Transaction.run({ sku: "widget", qty: 3 }))();

	expect(outcome).toStrictEqual(
		Result.make.ok({
			reserve: { resId: "res_widget_3" },
			charge: { chargeId: "ch_res_widget_3", amount: 150 },
			notify: { status: "sent", summary: "widget: res_widget_3 charged 150" },
		}),
	);
});

// =============================================================================
// Rollback & LIFO Compensation Mechanics
// =============================================================================

test("rollback: invokes completed step undo handlers in strict LIFO order on failure", async () => {
	const log: string[] = [];

	const tx = pipe(
		Transaction.make<{ readonly userId: string; }>(),
		Transaction.step({
			id: "step1",
			run: ({ initial }) => {
				log.push(`run:step1(${initial.userId})`);
				return Task.Result.make.ok("out1");
			},
			undo: (out, ctx) => {
				log.push(`undo:step1(${out}, initial=${ctx.initial.userId})`);
				return Task.Result.make.ok(undefined);
			},
		}),
		Transaction.step({
			id: "step2",
			run: ({ step1 }) => {
				log.push(`run:step2(${step1})`);
				return Task.Result.make.ok("out2");
			},
			undo: (out, ctx) => {
				log.push(`undo:step2(${out}, step1=${ctx.step1})`);
				return Task.Result.make.ok(undefined);
			},
		}),
		Transaction.step({
			id: "step3",
			run: () => {
				log.push("run:step3:fails");
				return Task.Result.make.err("step3_failed");
			},
			undo: () => {
				log.push("undo:step3:should_never_run");
				return Task.Result.make.ok(undefined);
			},
		}),
	);

	const outcome = await pipe(tx, Transaction.run({ userId: "user_42" }))();

	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "step3", error: "step3_failed", undoErrors: [] }),
	);

	expect(log).toStrictEqual([
		"run:step1(user_42)",
		"run:step2(out1)",
		"run:step3:fails",
		"undo:step2(out2, step1=out1)",
		"undo:step1(out1, initial=user_42)",
	]);
});

test("rollback: when step 1 fails, no undos are invoked and undoErrors is empty", async () => {
	let undoCalled = false;

	const tx = pipe(
		Transaction.make(),
		Transaction.step({
			id: "first",
			run: () => Task.Result.make.err("first_failed"),
			undo: () => {
				undoCalled = true;
				return Task.Result.make.ok(undefined);
			},
		}),
	);

	const outcome = await pipe(tx, Transaction.run())();

	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "first", error: "first_failed", undoErrors: [] }),
	);
	expect(undoCalled).toBe(false);
});

test("rollback: steps without undo are safely skipped during LIFO drainage", async () => {
	const rollbacks: string[] = [];

	const tx = pipe(
		Transaction.make(),
		Transaction.step({
			id: "s1",
			run: () => Task.Result.make.ok("v1"),
			undo: () => {
				rollbacks.push("s1");
				return Task.Result.make.ok(undefined);
			},
		}),
		Transaction.step({ id: "s2", run: () => Task.Result.make.ok("v2") }),
		Transaction.step({
			id: "s3",
			run: () => Task.Result.make.ok("v3"),
			undo: () => {
				rollbacks.push("s3");
				return Task.Result.make.ok(undefined);
			},
		}),
		Transaction.step({ id: "s4", run: () => Task.Result.make.err("s4_failed") }),
	);

	const outcome = await pipe(tx, Transaction.run())();

	expect(Result.is.err(outcome)).toBe(true);
	expect(rollbacks).toStrictEqual(["s3", "s1"]);
});

// =============================================================================
// Fault Handling in Undo (Best-Effort Drain & Attribution)
// =============================================================================

test("rollback: continues draining remaining undos when an intermediate undo fails or throws", async () => {
	const log: string[] = [];

	const tx = pipe(
		Transaction.make(),
		Transaction.step({
			id: "step1",
			run: () => Task.Result.make.ok(1),
			undo: () => {
				log.push("undo:step1");
				return Task.Result.make.ok(undefined);
			},
		}),
		Transaction.step({
			id: "step2",
			run: () => Task.Result.make.ok(2),
			undo: () => {
				log.push("undo:step2_fails");
				return Task.Result.make.err("step2_undo_err");
			},
		}),
		Transaction.step({
			id: "step3",
			run: () => Task.Result.make.ok(3),
			undo: () => {
				log.push("undo:step3_throws");
				throw new Error("step3_undo_thrown");
			},
		}),
		Transaction.step({
			id: "step4",
			run: () => {
				log.push("run:step4_fails");
				return Task.Result.make.err("forward_failure");
			},
		}),
	);

	const outcome = await pipe(tx, Transaction.run())();

	expect(outcome).toStrictEqual(
		Result.make.err({
			kind: "TransactionFailure",
			stepId: "step4",
			error: "forward_failure",
			undoErrors: [{ stepId: "step3", error: expect.any(Error) }, { stepId: "step2", error: "step2_undo_err" }],
		}),
	);

	expect(log).toStrictEqual(["run:step4_fails", "undo:step3_throws", "undo:step2_fails", "undo:step1"]);
});

// =============================================================================
// AbortSignal & Cancellation
// =============================================================================

test("abort: returns Err immediately if signal is already aborted before starting", async () => {
	const controller = new AbortController();
	controller.abort(new Error("pre_aborted"));

	let stepExecuted = false;

	const tx = pipe(
		Transaction.make(),
		Transaction.step({
			id: "s1",
			run: () => {
				stepExecuted = true;
				return Task.Result.make.ok("v1");
			},
		}),
	);

	const outcome = await pipe(tx, Transaction.run(undefined, { signal: controller.signal }))();

	expect(stepExecuted).toBe(false);
	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "s1", error: expect.any(Error), undoErrors: [] }),
	);
});

test("abort: triggers LIFO rollback of completed steps when aborted mid-flight", async () => {
	const controller = new AbortController();
	const log: string[] = [];

	const tx = pipe(
		Transaction.make(),
		Transaction.step({
			id: "s1",
			run: () => {
				log.push("run:s1");
				return Task.Result.make.ok("v1");
			},
			undo: () => {
				log.push("undo:s1");
				return Task.Result.make.ok(undefined);
			},
		}),
		Transaction.step({
			id: "s2",
			run: () => {
				log.push("run:s2:aborting");
				controller.abort(new Error("mid_flight_abort"));
				return Task.Result.make.ok("v2");
			},
			undo: () => {
				log.push("undo:s2");
				return Task.Result.make.ok(undefined);
			},
		}),
		Transaction.step({
			id: "s3",
			run: () => {
				log.push("run:s3:should_not_run");
				return Task.Result.make.ok("v3");
			},
		}),
	);

	const outcome = await pipe(tx, Transaction.run(undefined, { signal: controller.signal }))();

	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "s3", error: expect.any(Error), undoErrors: [] }),
	);

	expect(log).toStrictEqual(["run:s1", "run:s2:aborting", "undo:s2", "undo:s1"]);
});

// =============================================================================
// Resilience: RetryPolicy and Timeout
// =============================================================================

test("retry: transient step failure retries up to policy attempts and succeeds without rollback", async () => {
	let attempts = 0;
	let undoCalled = false;

	const tx = pipe(
		Transaction.make(),
		Transaction.step({
			id: "transientStep",
			retry: RetryPolicy.constant({ attempts: 3, delay: Duration.milliseconds(5) }),
			run: () => {
				attempts++;
				if (attempts < 3) {
					return Task.Result.make.err("transient_err");
				}
				return Task.Result.make.ok("recovered");
			},
			undo: () => {
				undoCalled = true;
				return Task.Result.make.ok(undefined);
			},
		}),
	);

	const outcome = await pipe(tx, Transaction.run())();

	expect(outcome).toStrictEqual(Result.make.ok({ transientStep: "recovered" }));
	expect(attempts).toBe(3);
	expect(undoCalled).toBe(false);
});

test("retry: step failure that exhausts retries initiates LIFO rollback", async () => {
	let attempts = 0;
	const log: string[] = [];

	const tx = pipe(
		Transaction.make(),
		Transaction.step({
			id: "step1",
			run: () => Task.Result.make.ok("s1_ok"),
			undo: () => {
				log.push("undo:step1");
				return Task.Result.make.ok(undefined);
			},
		}),
		Transaction.step({
			id: "step2",
			retry: RetryPolicy.constant({ attempts: 2, delay: Duration.milliseconds(5) }),
			run: () => {
				attempts++;
				return Task.Result.make.err(`retry_err_${attempts}`);
			},
		}),
	);

	const outcome = await pipe(tx, Transaction.run())();

	expect(attempts).toBe(2);
	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "step2", error: "retry_err_2", undoErrors: [] }),
	);
	expect(log).toStrictEqual(["undo:step1"]);
});

test("timeout: forward step exceeding timeout duration fails and rolls back", async () => {
	const log: string[] = [];

	const tx = pipe(
		Transaction.make(),
		Transaction.step({
			id: "step1",
			run: () => Task.Result.make.ok("s1_ok"),
			undo: () => {
				log.push("undo:step1");
				return Task.Result.make.ok(undefined);
			},
		}),
		Transaction.step({
			id: "slowStep",
			timeout: { duration: Duration.milliseconds(10), onTimeout: () => "timed_out" },
			run: () => () =>
				Deferred.from.Promise(
					new Promise<Result<never, string>>((resolve) => {
						setTimeout(() => resolve(Result.make.ok("too_late")), 50);
					}),
				),
		}),
	);

	const outcome = await pipe(tx, Transaction.run())();

	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "slowStep", error: "timed_out", undoErrors: [] }),
	);
	expect(log).toStrictEqual(["undo:step1"]);
});

// =============================================================================
// Telemetry Hooks & Exception Isolation
// =============================================================================

test("telemetry: fires onStepSuccess, onStepFailure, and onUndo hooks", async () => {
	const successes: Array<{ stepId: string; output: unknown; }> = [];
	const failures: Array<{ stepId: string; error: unknown; }> = [];
	const undos: Array<{ stepId: string; error?: unknown; }> = [];

	const tx = pipe(
		Transaction.make(),
		Transaction.step({ id: "s1", run: () => Task.Result.make.ok("val1"), undo: () => Task.Result.make.ok(undefined) }),
		Transaction.step({ id: "s2", run: () => Task.Result.make.err("fail2"), undo: () => Task.Result.make.ok(undefined) }),
	);

	await pipe(
		tx,
		Transaction.run(undefined, {
			onStepSuccess: (meta) => successes.push(meta),
			onStepFailure: (meta) => failures.push(meta),
			onUndo: (meta) => undos.push(meta),
		}),
	)();

	expect(successes).toStrictEqual([{ stepId: "s1", output: "val1" }]);
	expect(failures).toStrictEqual([{ stepId: "s2", error: "fail2" }]);
	expect(undos).toStrictEqual([{ stepId: "s1" }]);
});

test("telemetry: fires onUndo with error when undo fails, and tolerates onUndo throwing", async () => {
	const undos: Array<{ stepId: string; error?: unknown; }> = [];

	const tx = pipe(
		Transaction.make(),
		Transaction.step({
			id: "s1",
			run: () => Task.Result.make.ok("v1"),
			undo: () => Task.Result.make.err("undo_failed_err"),
		}),
		Transaction.step({ id: "s2", run: () => Task.Result.make.err("step2_fail") }),
	);

	const outcome = await pipe(
		tx,
		Transaction.run(undefined, {
			onUndo: (meta) => {
				undos.push(meta);
				throw new Error("onUndo_crash");
			},
		}),
	)();

	expect(Result.is.err(outcome)).toBe(true);
	expect(undos).toStrictEqual([{ stepId: "s1", error: "undo_failed_err" }]);
});

test("signals: combines callerSignal and option signal via AbortSignal.any", async () => {
	const callerCtrl = new AbortController();
	const optionCtrl = new AbortController();

	const tx = pipe(
		Transaction.make(),
		Transaction.step({ id: "s1", run: () => Task.Result.make.ok("v1") }),
		Transaction.step({
			id: "s2",
			run: () => {
				callerCtrl.abort(new Error("caller_abort"));
				return Task.Result.make.ok("v2");
			},
		}),
		Transaction.step({ id: "s3", run: () => Task.Result.make.ok("v3") }),
	);

	const task = Transaction.run(undefined, { signal: optionCtrl.signal })(tx);
	const outcome = await task(callerCtrl.signal);

	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "s3", error: expect.any(Error), undoErrors: [] }),
	);
});

test("security: guards against prototype pollution", async () => {
	const tx = pipe(Transaction.make(), Transaction.step({ id: "__proto__", run: () => Task.Result.make.ok("polluted") }));

	const outcome = await pipe(tx, Transaction.run())();
	expect(Result.is.ok(outcome)).toBe(true);
	expect("polluted" in Object.prototype).toBe(false);
});

test("run: forward step throwing uncaught error safely fails and rolls back", async () => {
	let undoCalled = false;

	const tx = pipe(
		Transaction.make(),
		Transaction.step({
			id: "s1",
			run: () => Task.Result.make.ok(1),
			undo: () => {
				undoCalled = true;
				return Task.Result.make.ok(undefined);
			},
		}),
		Transaction.step({
			id: "s2",
			run: () => {
				throw new Error("sync_crash");
			},
		}),
	);

	const outcome = await pipe(tx, Transaction.run())();

	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "s2", error: expect.any(Error), undoErrors: [] }),
	);
	expect(undoCalled).toBe(true);
});

test("run: accepts run options directly when transaction takes no input", async () => {
	let succeeded = false;
	const tx = pipe(Transaction.make(), Transaction.step({ id: "s1", run: () => Task.Result.make.ok("v1") }));
	const outcome = await pipe(
		tx,
		Transaction.run({
			onStepSuccess: () => {
				succeeded = true;
			},
		}),
	)();
	expect(Result.is.ok(outcome)).toBe(true);
	expect(succeeded).toBe(true);
});

test("telemetry: tolerates onStepSuccess throwing", async () => {
	const tx = pipe(Transaction.make(), Transaction.step({ id: "s1", run: () => Task.Result.make.ok("v1") }));
	const outcome = await pipe(
		tx,
		Transaction.run({
			onStepSuccess: () => {
				throw new Error("success_crash");
			},
		}),
	)();
	expect(Result.is.ok(outcome)).toBe(true);
});

test("telemetry: tolerates onStepFailure throwing", async () => {
	const tx = pipe(Transaction.make(), Transaction.step({ id: "s1", run: () => Task.Result.make.err("failed") }));
	const outcome = await pipe(
		tx,
		Transaction.run({
			onStepFailure: () => {
				throw new Error("failure_crash");
			},
		}),
	)();
	expect(Result.is.err(outcome)).toBe(true);
});

test("telemetry: tolerates onUndo throwing on successful undo", async () => {
	const tx = pipe(
		Transaction.make(),
		Transaction.step({ id: "s1", run: () => Task.Result.make.ok("v1"), undo: () => Task.Result.make.ok(undefined) }),
		Transaction.step({ id: "s2", run: () => Task.Result.make.err("fail") }),
	);
	const outcome = await pipe(
		tx,
		Transaction.run({
			onUndo: () => {
				throw new Error("undo_hook_crash");
			},
		}),
	)();
	expect(Result.is.err(outcome)).toBe(true);
});

test("rollback: captures synchronous throw in undo function", async () => {
	const tx = pipe(
		Transaction.make(),
		Transaction.step({
			id: "s1",
			run: () => Task.Result.make.ok("v1"),
			undo: () => {
				throw new Error("sync_undo_throw");
			},
		}),
		Transaction.step({ id: "s2", run: () => Task.Result.make.err("fail") }),
	);
	const outcome = await pipe(tx, Transaction.run())();
	expect(outcome).toStrictEqual(
		Result.make.err({
			kind: "TransactionFailure",
			stepId: "s2",
			error: "fail",
			undoErrors: [{ stepId: "s1", error: expect.any(Error) }],
		}),
	);
});

test("rollback: captures thrown error during undo Task execution and tolerates onUndo error", async () => {
	const tx = pipe(
		Transaction.make(),
		Transaction.step({
			id: "s1",
			run: () => Task.Result.make.ok("v1"),
			undo: () => () =>
				Deferred.from.Promise<Result<never, unknown>>({
					then() {
						throw new Error("undo_deferred_crash");
					},
				}),
		}),
		Transaction.step({ id: "s2", run: () => Task.Result.make.err("fail") }),
	);
	const outcome = await pipe(
		tx,
		Transaction.run(undefined, {
			onUndo: () => {
				throw new Error("onUndo_throw_during_catch");
			},
		}),
	)();
	expect(outcome).toStrictEqual(
		Result.make.err({
			kind: "TransactionFailure",
			stepId: "s2",
			error: "fail",
			undoErrors: [{ stepId: "s1", error: expect.any(Error) }],
		}),
	);
});

test("rollback: captures thrown error during undo Task execution without onUndo hook", async () => {
	const tx = pipe(
		Transaction.make(),
		Transaction.step({
			id: "s1",
			run: () => Task.Result.make.ok("v1"),
			undo: () => () =>
				Deferred.from.Promise<Result<never, unknown>>({
					then() {
						throw new Error("undo_deferred_crash_no_hook");
					},
				}),
		}),
		Transaction.step({ id: "s2", run: () => Task.Result.make.err("fail") }),
	);
	const outcome = await pipe(tx, Transaction.run())();
	expect(outcome).toStrictEqual(
		Result.make.err({
			kind: "TransactionFailure",
			stepId: "s2",
			error: "fail",
			undoErrors: [{ stepId: "s1", error: expect.any(Error) }],
		}),
	);
});

test("run: captures thrown error during step Task execution", async () => {
	const tx = pipe(
		Transaction.make(),
		Transaction.step({
			id: "s1",
			run: () => () =>
				Deferred.from.Promise<Result<never, unknown>>({
					then() {
						throw new Error("step_deferred_crash");
					},
				}),
		}),
	);
	const outcome = await pipe(tx, Transaction.run())();
	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "s1", error: expect.any(Error), undoErrors: [] }),
	);
});

test("run: returns initial stepId when empty transaction is aborted prior to execution", async () => {
	const ctrl = new AbortController();
	ctrl.abort(new Error("aborted_empty"));
	const tx = Transaction.make();
	const outcome = await pipe(tx, Transaction.run({ signal: ctrl.signal }))();
	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "initial", error: expect.any(Error), undoErrors: [] }),
	);
});

test("run: falls back to default error when signal reason is null or undefined", async () => {
	const ctrl = new AbortController();
	ctrl.abort(null);
	const tx = Transaction.make();
	const outcome = await pipe(tx, Transaction.run({ signal: ctrl.signal }))();
	expect(outcome).toStrictEqual(
		Result.make.err({
			kind: "TransactionFailure",
			stepId: "initial",
			error: expect.objectContaining({ message: "[Transaction.run] Aborted before execution" }),
			undoErrors: [],
		}),
	);
});

test("run: falls back to default error when signal reason is null or undefined during step execution", async () => {
	const ctrl = new AbortController();

	const tx = pipe(
		Transaction.make(),
		Transaction.step({
			id: "s1",
			run: () => {
				ctrl.abort(null);
				return Task.Result.make.ok("v1");
			},
		}),
		Transaction.step({ id: "s2", run: () => Task.Result.make.ok("v2") }),
	);

	const outcome = await pipe(tx, Transaction.run({ signal: ctrl.signal }))();
	expect(outcome).toStrictEqual(
		Result.make.err({
			kind: "TransactionFailure",
			stepId: "s2",
			error: expect.objectContaining({ message: "[Transaction.run] Aborted before step 's2'" }),
			undoErrors: [],
		}),
	);
});

test("run: preserves input payload containing a 'signal' property without mistaking it for RunOptions", async () => {
	type TelemetryEvent = { readonly signal: string; readonly priority: number; };

	const tx = pipe(
		Transaction.make<TelemetryEvent>(),
		Transaction.step({
			id: "process",
			run: ({ initial }) => Task.Result.make.ok(`handled:${initial.signal}:${initial.priority}`),
		}),
	);

	const outcome = await pipe(tx, Transaction.run({ signal: "ALERT", priority: 1 }))();

	expect(outcome).toStrictEqual(Result.make.ok({ process: "handled:ALERT:1" }));
});

test("run: preserves diverse input payloads that share names with RunOptions keys without mistaking them for options", async () => {
	// 1. Single-property string signal (not an AbortSignal):
	const sigTx = pipe(
		Transaction.make<{ readonly signal: string; }>(),
		Transaction.step({ id: "s", run: ({ initial }) => Task.Result.make.ok(initial.signal) }),
	);
	const sigOutcome = await pipe(sigTx, Transaction.run({ signal: "not-an-abort-signal" }))();
	expect(sigOutcome).toStrictEqual(Result.make.ok({ s: "not-an-abort-signal" }));

	// 2. Single-property non-function onStepSuccess:
	const succTx = pipe(
		Transaction.make<{ readonly onStepSuccess: string; }>(),
		Transaction.step({ id: "s", run: ({ initial }) => Task.Result.make.ok(initial.onStepSuccess) }),
	);
	const succOutcome = await pipe(succTx, Transaction.run({ onStepSuccess: "status" }))();
	expect(succOutcome).toStrictEqual(Result.make.ok({ s: "status" }));

	// 3. Single-property non-function onStepFailure:
	const failTx = pipe(
		Transaction.make<{ readonly onStepFailure: number; }>(),
		Transaction.step({ id: "s", run: ({ initial }) => Task.Result.make.ok(initial.onStepFailure) }),
	);
	const failOutcome = await pipe(failTx, Transaction.run({ onStepFailure: 42 }))();
	expect(failOutcome).toStrictEqual(Result.make.ok({ s: 42 }));

	// 4. Single-property non-function onUndo:
	const undoTx = pipe(
		Transaction.make<{ readonly onUndo: boolean; }>(),
		Transaction.step({ id: "s", run: ({ initial }) => Task.Result.make.ok(initial.onUndo) }),
	);
	const undoOutcome = await pipe(undoTx, Transaction.run({ onUndo: true }))();
	expect(undoOutcome).toStrictEqual(Result.make.ok({ s: true }));

	// 5. Array input payload:
	const arrTx = pipe(
		Transaction.make<readonly number[]>(),
		Transaction.step({ id: "s", run: ({ initial }) => Task.Result.make.ok(initial.length) }),
	);
	const arrOutcome = await pipe(arrTx, Transaction.run([10, 20, 30]))();
	expect(arrOutcome).toStrictEqual(Result.make.ok({ s: 3 }));

	// 6. Empty object input payload:
	const emptyTx = pipe(
		Transaction.make<Record<string, never>>(),
		Transaction.step({ id: "s", run: () => Task.Result.make.ok("done") }),
	);
	const emptyOutcome = await pipe(emptyTx, Transaction.run({}, undefined))();
	expect(emptyOutcome).toStrictEqual(Result.make.ok({ s: "done" }));
});

test("forward: executes an empty transaction returning an empty record", async () => {
	const tx = Transaction.make();
	const outcome = await pipe(tx, Transaction.run())();
	expect(outcome).toStrictEqual(Result.make.ok({}));
});
