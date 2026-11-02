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

test("run: starts immediately and isolates input and output between runs", async () => {
	const seen: string[] = [];
	const transactionStep0 = Transaction.step({
		id: "saved",
		run: () => (initial: { readonly orderId: string; }) => {
			seen.push(initial.orderId);
			return Task.Result.make.ok(initial.orderId);
		},
	});
	const transaction = Transaction.make(transactionStep0);
	const first = Transaction.run(transaction, { input: { orderId: "first" } });
	const second = Transaction.run(transaction, { input: { orderId: "second" } });
	expect(seen).toStrictEqual(["first", "second"]);
	const firstResult = await first;
	const secondResult = await second;
	expect(firstResult).toStrictEqual(Result.make.ok({ saved: "first" }));
	expect(secondResult).toStrictEqual(Result.make.ok({ saved: "second" }));
});

test("step: throws TypeError if id is empty", () => {
	expect(() => Transaction.step({ id: "", run: () => () => Task.Result.make.ok(1) })).toThrow(TypeError);
});

test("step: throws TypeError if id is 'initial'", () => {
	expect(() =>
		Transaction.step({
			// @ts-expect-error — 'initial' is reserved
			id: "initial",
			run: () => () => Task.Result.make.ok(1),
		})
	).toThrow(TypeError);
});

test("step: throws Error on duplicate step id", () => {
	const id = (): string => "stepA";
	const first = Transaction.step({ id: id(), run: () => () => Task.Result.make.ok(1) });
	const second = Transaction.step({ id: id(), run: () => () => Task.Result.make.ok(2) });
	expect(() => Transaction.make(first, second)).toThrow(/Duplicate step id 'stepA'/);
});

test("make: rejects missing, later, and different steps with the same id", () => {
	const upload = Transaction.step({ id: "upload", run: () => () => Task.Result.make.ok("file") });
	const anotherUpload = Transaction.step({ id: "upload", run: () => () => Task.Result.make.ok("other") });
	const index = Transaction.step({
		id: "index",
		deps: { file: upload },
		run: ({ file }) => () => Task.Result.make.ok(file.length),
	});
	const missing: Transaction.AnyStep<void>[] = [index];
	const later: Transaction.AnyStep<void>[] = [index, upload];
	const different: Transaction.AnyStep<void>[] = [anotherUpload, index];

	expect(() => Transaction.make(...missing)).toThrow(/Dependency 'upload' must precede step 'index'/);
	expect(() => Transaction.make(...later)).toThrow(/Dependency 'upload' must precede step 'index'/);
	expect(() => Transaction.make(...different)).toThrow(/Dependency 'upload' must precede step 'index'/);
});

test("make: validates the identity of a broadly typed dependency", async () => {
	type Order = { readonly sku: string; };
	const reserve = Transaction.step({ id: "reserve", run: () => (order: Order) => Task.Result.make.ok(order.sku) });
	const other = Transaction.step({ id: "other", run: () => (order: Order) => Task.Result.make.ok(order.sku) });
	const build = (dependency: Transaction.AnyStep<Order>) => {
		const dependent = Transaction.step({
			id: "dependent",
			deps: { dependency },
			run: ({ dependency: previous }) => (order: Order) => Task.Result.make.ok({ dependency: previous, sku: order.sku }),
		});
		return Transaction.make(reserve, dependent);
	};

	const result = await Transaction.run(build(reserve), { input: { sku: "book" } });
	expect(result).toStrictEqual(Result.make.ok({ reserve: "book", dependent: { dependency: "book", sku: "book" } }));
	expect(() => build(other)).toThrow(/Dependency 'other' must precede step 'dependent'/);
});

test("make: supports conditional and absent dependencies without skipping validation", async () => {
	const first = Transaction.step({ id: "first", run: () => () => Task.Result.make.ok("one") });
	const other = Transaction.step({ id: "other", run: () => () => Task.Result.make.ok("two") });
	const build = (useFirst: boolean) => {
		const deps = useFirst ? { primary: first } : { alternate: other };
		const dependent = Transaction.step({
			id: "dependent",
			deps,
			run: (resolved) => () => Task.Result.make.ok(resolved.primary ?? resolved.alternate),
		});
		return Transaction.make(first, dependent);
	};
	const result = await Transaction.run(build(true));
	expect(result).toStrictEqual(Result.make.ok({ first: "one", dependent: "one" }));
	expect(() => build(false)).toThrow(/Dependency 'other' must precede step 'dependent'/);

	const optional = Transaction.step({
		id: "optional",
		deps: { skipped: undefined },
		run: (resolved) => () => Task.Result.make.ok(Object.hasOwn(resolved, "skipped")),
	});
	const optionalResult = await Transaction.run(Transaction.make(optional));
	expect(optionalResult).toStrictEqual(Result.make.ok({ optional: false }));
});

test("rollback: compensation receives dependency aliases and the same run input", async () => {
	type Order = { readonly customer: string; };
	const log: string[] = [];
	const upload = Transaction.step({
		id: "upload",
		run: () => (order: Order) => Task.Result.make.ok(`file:${order.customer}`),
	});
	const index = Transaction.step({
		id: "index",
		deps: { file: upload },
		run: ({ file }) => (order: Order) => Task.Result.make.ok(`${file}:${order.customer}`),
		undo: (value, { file }, order) => {
			log.push(`${value}|${file}|${order.customer}`);
			return Task.Result.make.ok(undefined);
		},
	});
	const notify = Transaction.step({ id: "notify", run: () => () => Task.Result.make.err("offline") });
	const outcome = await Transaction.run(Transaction.make(upload, index, notify), { input: { customer: "Mina" } });

	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "notify", error: "offline", undoErrors: [] }),
	);
	expect(log).toStrictEqual(["file:Mina:Mina|file:Mina|Mina"]);
});

// =============================================================================
// Forward Execution & Context Accumulation
// =============================================================================

test("forward: executes sequential steps without input and accumulates outputs", async () => {
	const order: string[] = [];

	const transactionStep0 = Transaction.step({
		id: "first",
		run: () => () => {
			order.push("run:first");
			return Task.Result.make.ok(10);
		},
	});
	const transactionStep1 = Transaction.step({
		id: "second",
		deps: { first: transactionStep0 },
		run: (ctx) => () => {
			order.push(`run:second(${ctx.first})`);
			return Task.Result.make.ok(`val_${ctx.first * 2}`);
		},
	});
	const tx = Transaction.make(transactionStep0, transactionStep1);

	const outcome = await Transaction.run(tx);

	expect(outcome).toStrictEqual(Result.make.ok({ first: 10, second: "val_20" }));
	expect(order).toStrictEqual(["run:first", "run:second(10)"]);
});

test("forward: threads initial input and prior step outputs across all steps", async () => {
	type Input = { readonly sku: string; readonly qty: number; };

	const transactionStep0 = Transaction.step({
		id: "reserve",
		run: () => (initial: Input) => Task.Result.make.ok({ resId: `res_${initial.sku}_${initial.qty}` }),
	});
	const transactionStep1 = Transaction.step({
		id: "charge",
		deps: { reserve: transactionStep0 },
		run: ({ reserve }) => (initial: Input) =>
			Task.Result.make.ok({ chargeId: `ch_${reserve.resId}`, amount: initial.qty * 50 }),
	});
	const transactionStep2 = Transaction.step({
		id: "notify",
		deps: { reserve: transactionStep0, charge: transactionStep1 },
		run: ({ reserve, charge }) => (initial: Input) =>
			Task.Result.make.ok({ status: "sent", summary: `${initial.sku}: ${reserve.resId} charged ${charge.amount}` }),
	});
	const tx = Transaction.make(transactionStep0, transactionStep1, transactionStep2);

	const outcome = await Transaction.run(tx, { input: { sku: "widget", qty: 3 } });

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

	const transactionStep0 = Transaction.step({
		id: "step1",
		run: () => (initial: { readonly userId: string; }) => {
			log.push(`run:step1(${initial.userId})`);
			return Task.Result.make.ok("out1");
		},
		undo: (out, ctx, initial) => {
			log.push(`undo:step1(${out}, initial=${initial.userId})`);
			return Task.Result.make.ok(undefined);
		},
	});
	const transactionStep1 = Transaction.step({
		id: "step2",
		deps: { step1: transactionStep0 },
		run: ({ step1 }) => (_input: { readonly userId: string; }) => {
			log.push(`run:step2(${step1})`);
			return Task.Result.make.ok("out2");
		},
		undo: (out, ctx) => {
			log.push(`undo:step2(${out}, step1=${ctx.step1})`);
			return Task.Result.make.ok(undefined);
		},
	});
	const transactionStep2 = Transaction.step({
		id: "step3",
		run: () => (_input: { readonly userId: string; }) => {
			log.push("run:step3:fails");
			return Task.Result.make.err("step3_failed");
		},
		undo: () => {
			log.push("undo:step3:should_never_run");
			return Task.Result.make.ok(undefined);
		},
	});
	const tx = Transaction.make(transactionStep0, transactionStep1, transactionStep2);

	const outcome = await Transaction.run(tx, { input: { userId: "user_42" } });

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

	const transactionStep0 = Transaction.step({
		id: "first",
		run: () => () => Task.Result.make.err("first_failed"),
		undo: () => {
			undoCalled = true;
			return Task.Result.make.ok(undefined);
		},
	});
	const tx = Transaction.make(transactionStep0);

	const outcome = await Transaction.run(tx);

	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "first", error: "first_failed", undoErrors: [] }),
	);
	expect(undoCalled).toBe(false);
});

test("rollback: steps without undo are safely skipped during LIFO drainage", async () => {
	const rollbacks: string[] = [];

	const transactionStep0 = Transaction.step({
		id: "s1",
		run: () => () => Task.Result.make.ok("v1"),
		undo: () => {
			rollbacks.push("s1");
			return Task.Result.make.ok(undefined);
		},
	});
	const transactionStep1 = Transaction.step({ id: "s2", run: () => () => Task.Result.make.ok("v2") });
	const transactionStep2 = Transaction.step({
		id: "s3",
		run: () => () => Task.Result.make.ok("v3"),
		undo: () => {
			rollbacks.push("s3");
			return Task.Result.make.ok(undefined);
		},
	});
	const transactionStep3 = Transaction.step({ id: "s4", run: () => () => Task.Result.make.err("s4_failed") });
	const tx = Transaction.make(transactionStep0, transactionStep1, transactionStep2, transactionStep3);

	const outcome = await Transaction.run(tx);

	expect(Result.is.err(outcome)).toBe(true);
	expect(rollbacks).toStrictEqual(["s3", "s1"]);
});

// =============================================================================
// Fault Handling in Undo (Best-Effort Drain & Attribution)
// =============================================================================

test("rollback: continues draining remaining undos when intermediate undos return errors", async () => {
	const log: string[] = [];

	const transactionStep0 = Transaction.step({
		id: "step1",
		run: () => () => Task.Result.make.ok(1),
		undo: () => {
			log.push("undo:step1");
			return Task.Result.make.ok(undefined);
		},
	});
	const transactionStep1 = Transaction.step({
		id: "step2",
		run: () => () => Task.Result.make.ok(2),
		undo: () => {
			log.push("undo:step2_fails");
			return Task.Result.make.err("step2_undo_err");
		},
	});
	const transactionStep2 = Transaction.step({
		id: "step3",
		run: () => () => Task.Result.make.ok(3),
		undo: () => {
			log.push("undo:step3_fails");
			return Task.Result.make.err("step3_undo_err");
		},
	});
	const transactionStep3 = Transaction.step({
		id: "step4",
		run: () => () => {
			log.push("run:step4_fails");
			return Task.Result.make.err("forward_failure");
		},
	});
	const tx = Transaction.make(transactionStep0, transactionStep1, transactionStep2, transactionStep3);

	const outcome = await Transaction.run(tx);

	expect(outcome).toStrictEqual(
		Result.make.err({
			kind: "TransactionFailure",
			stepId: "step4",
			error: "forward_failure",
			undoErrors: [{ stepId: "step3", error: "step3_undo_err" }, { stepId: "step2", error: "step2_undo_err" }],
		}),
	);

	expect(log).toStrictEqual(["run:step4_fails", "undo:step3_fails", "undo:step2_fails", "undo:step1"]);
});

// =============================================================================
// AbortSignal & Cancellation
// =============================================================================

test("abort: returns Err immediately if signal is already aborted before starting", async () => {
	const controller = new AbortController();
	controller.abort(new Error("pre_aborted"));

	let stepExecuted = false;

	const transactionStep0 = Transaction.step({
		id: "s1",
		run: () => () => {
			stepExecuted = true;
			return Task.Result.make.ok("v1");
		},
	});
	const tx = Transaction.make(transactionStep0);

	const outcome = await Transaction.run(tx, { signal: controller.signal });

	expect(stepExecuted).toBe(false);
	expect(outcome).toStrictEqual(
		Result.make.err({
			kind: "TransactionFailure",
			stepId: "s1",
			error: { kind: "TransactionAborted", reason: expect.any(Error) },
			undoErrors: [],
		}),
	);
});

test("abort: triggers LIFO rollback of completed steps when aborted mid-flight", async () => {
	const controller = new AbortController();
	const log: string[] = [];

	const transactionStep0 = Transaction.step({
		id: "s1",
		run: () => () => {
			log.push("run:s1");
			return Task.Result.make.ok("v1");
		},
		undo: () => {
			log.push("undo:s1");
			return Task.Result.make.ok(undefined);
		},
	});
	const transactionStep1 = Transaction.step({
		id: "s2",
		run: () => () => {
			log.push("run:s2:aborting");
			controller.abort(new Error("mid_flight_abort"));
			return Task.Result.make.ok("v2");
		},
		undo: () => {
			log.push("undo:s2");
			return Task.Result.make.ok(undefined);
		},
	});
	const transactionStep2 = Transaction.step({
		id: "s3",
		run: () => () => {
			log.push("run:s3:should_not_run");
			return Task.Result.make.ok("v3");
		},
	});
	const tx = Transaction.make(transactionStep0, transactionStep1, transactionStep2);

	const outcome = await Transaction.run(tx, { signal: controller.signal });

	expect(outcome).toStrictEqual(
		Result.make.err({
			kind: "TransactionFailure",
			stepId: "s3",
			error: { kind: "TransactionAborted", reason: expect.any(Error) },
			undoErrors: [],
		}),
	);

	expect(log).toStrictEqual(["run:s1", "run:s2:aborting", "undo:s2", "undo:s1"]);
});

// =============================================================================
// Resilience: RetryPolicy and Timeout
// =============================================================================

test("retry: transient step failure retries up to policy attempts and succeeds without rollback", async () => {
	let attempts = 0;
	let undoCalled = false;

	const transactionStep0 = Transaction.step({
		id: "transientStep",
		retry: RetryPolicy.constant({ attempts: 3, delay: Duration.milliseconds(5) }),
		run: () => () => {
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
	});
	const tx = Transaction.make(transactionStep0);

	const outcome = await Transaction.run(tx);

	expect(outcome).toStrictEqual(Result.make.ok({ transientStep: "recovered" }));
	expect(attempts).toBe(3);
	expect(undoCalled).toBe(false);
});

test("retry: step failure that exhausts retries initiates LIFO rollback", async () => {
	let attempts = 0;
	const log: string[] = [];

	const transactionStep0 = Transaction.step({
		id: "step1",
		run: () => () => Task.Result.make.ok("s1_ok"),
		undo: () => {
			log.push("undo:step1");
			return Task.Result.make.ok(undefined);
		},
	});
	const transactionStep1 = Transaction.step({
		id: "step2",
		retry: RetryPolicy.constant({ attempts: 2, delay: Duration.milliseconds(5) }),
		run: () => () => {
			attempts++;
			return Task.Result.make.err(`retry_err_${attempts}`);
		},
	});
	const tx = Transaction.make(transactionStep0, transactionStep1);

	const outcome = await Transaction.run(tx);

	expect(attempts).toBe(2);
	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "step2", error: "retry_err_2", undoErrors: [] }),
	);
	expect(log).toStrictEqual(["undo:step1"]);
});

test("timeout: forward step exceeding timeout duration fails and rolls back", async () => {
	const log: string[] = [];

	const transactionStep0 = Transaction.step({
		id: "step1",
		run: () => () => Task.Result.make.ok("s1_ok"),
		undo: () => {
			log.push("undo:step1");
			return Task.Result.make.ok(undefined);
		},
	});
	const transactionStep1 = Transaction.step({
		id: "slowStep",
		timeout: { duration: Duration.milliseconds(10), onTimeout: () => "timed_out" },
		run: () => () => () =>
			Deferred.from.Promise(
				new Promise<Result<never, string>>((resolve) => {
					setTimeout(() => resolve(Result.make.ok("too_late")), 50);
				}),
			),
	});
	const tx = Transaction.make(transactionStep0, transactionStep1);

	const outcome = await Transaction.run(tx);

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

	const transactionStep0 = Transaction.step({
		id: "s1",
		run: () => () => Task.Result.make.ok("val1"),
		undo: () => Task.Result.make.ok(undefined),
	});
	const transactionStep1 = Transaction.step({
		id: "s2",
		run: () => () => Task.Result.make.err("fail2"),
		undo: () => Task.Result.make.ok(undefined),
	});
	const tx = Transaction.make(transactionStep0, transactionStep1);

	await Transaction.run(tx, {
		onStepSuccess: (meta) => successes.push(meta),
		onStepFailure: (meta) => failures.push(meta),
		onUndo: (meta) => undos.push(meta),
	});

	expect(successes).toStrictEqual([{ stepId: "s1", output: "val1" }]);
	expect(failures).toStrictEqual([{ stepId: "s2", error: "fail2" }]);
	expect(undos).toStrictEqual([{ stepId: "s1" }]);
});

test("telemetry: fires onUndo with the error when undo fails", async () => {
	const undos: Array<{ stepId: string; error?: unknown; }> = [];

	const transactionStep0 = Transaction.step({
		id: "s1",
		run: () => () => Task.Result.make.ok("v1"),
		undo: () => Task.Result.make.err("undo_failed_err"),
	});
	const transactionStep1 = Transaction.step({ id: "s2", run: () => () => Task.Result.make.err("step2_fail") });
	const tx = Transaction.make(transactionStep0, transactionStep1);

	const outcome = await Transaction.run(tx, {
		onUndo: (meta) => {
			undos.push(meta);
		},
	});

	expect(Result.is.err(outcome)).toBe(true);
	expect(undos).toStrictEqual([{ stepId: "s1", error: "undo_failed_err" }]);
});

test("signals: aborts a running transaction through the run signal", async () => {
	const callerCtrl = new AbortController();

	const transactionStep0 = Transaction.step({ id: "s1", run: () => () => Task.Result.make.ok("v1") });
	const transactionStep1 = Transaction.step({
		id: "s2",
		run: () => () => {
			callerCtrl.abort(new Error("caller_abort"));
			return Task.Result.make.ok("v2");
		},
	});
	const transactionStep2 = Transaction.step({ id: "s3", run: () => () => Task.Result.make.ok("v3") });
	const tx = Transaction.make(transactionStep0, transactionStep1, transactionStep2);

	const outcome = await Transaction.run(tx, { signal: callerCtrl.signal });

	expect(outcome).toStrictEqual(
		Result.make.err({
			kind: "TransactionFailure",
			stepId: "s3",
			error: { kind: "TransactionAborted", reason: expect.any(Error) },
			undoErrors: [],
		}),
	);
});

test("step: defines __proto__ as an own property without mutating the output or context prototype", async () => {
	const payload = { polluted: true };
	const transactionStep0 = Transaction.step({ id: "__proto__", run: () => () => Task.Result.make.ok(payload) });
	const transactionStep1 = Transaction.step({
		id: "verifyContext",
		deps: { ["__proto__"]: transactionStep0 },
		run: (ctx) => () =>
			Task.Result.make.ok({
				hasOwnProto: Object.hasOwn(ctx, "__proto__"),
				protoIsPlain: Object.getPrototypeOf(ctx) === Object.prototype,
				inheritedPolluted: "polluted" in ctx,
			}),
	});
	const tx = Transaction.make(transactionStep0, transactionStep1);

	const outcome = await Transaction.run(tx);
	expect(Result.is.ok(outcome)).toBe(true);
	const output = pipe(
		outcome,
		Result.getOrElse(() => ({
			__proto__: { polluted: false },
			verifyContext: { hasOwnProto: false, protoIsPlain: false, inheritedPolluted: true },
		})),
	);
	expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
	expect(Object.hasOwn(output, "__proto__")).toBe(true);
	expect(output.__proto__).toStrictEqual(payload);
	expect("polluted" in output).toBe(false);
	expect(output.verifyContext).toStrictEqual({ hasOwnProto: true, protoIsPlain: true, inheritedPolluted: false });
});

test("run: accepts run options as second argument when transaction takes no input", async () => {
	let succeeded = false;
	const transactionStep0 = Transaction.step({ id: "s1", run: () => () => Task.Result.make.ok("v1") });
	const tx = Transaction.make(transactionStep0);
	const outcome = await Transaction.run(tx, {
		onStepSuccess: () => {
			succeeded = true;
		},
	});
	expect(Result.is.ok(outcome)).toBe(true);
	expect(succeeded).toBe(true);
});

test("run: returns initial stepId when empty transaction is aborted prior to execution", async () => {
	const ctrl = new AbortController();
	ctrl.abort(new Error("aborted_empty"));
	const tx = Transaction.make();
	const outcome = await Transaction.run(tx, { signal: ctrl.signal });
	expect(outcome).toStrictEqual(
		Result.make.err({
			kind: "TransactionFailure",
			stepId: "initial",
			error: { kind: "TransactionAborted", reason: expect.any(Error) },
			undoErrors: [],
		}),
	);
});

test("run: preserves a null signal reason before execution", async () => {
	const ctrl = new AbortController();
	ctrl.abort(null);
	const tx = Transaction.make();
	const outcome = await Transaction.run(tx, { signal: ctrl.signal });
	expect(outcome).toStrictEqual(
		Result.make.err({
			kind: "TransactionFailure",
			stepId: "initial",
			error: { kind: "TransactionAborted", reason: null },
			undoErrors: [],
		}),
	);
});

test("run: preserves a null signal reason between steps", async () => {
	const ctrl = new AbortController();

	const transactionStep0 = Transaction.step({
		id: "s1",
		run: () => () => {
			ctrl.abort(null);
			return Task.Result.make.ok("v1");
		},
	});
	const transactionStep1 = Transaction.step({ id: "s2", run: () => () => Task.Result.make.ok("v2") });
	const tx = Transaction.make(transactionStep0, transactionStep1);

	const outcome = await Transaction.run(tx, { signal: ctrl.signal });
	expect(outcome).toStrictEqual(
		Result.make.err({
			kind: "TransactionFailure",
			stepId: "s2",
			error: { kind: "TransactionAborted", reason: null },
			undoErrors: [],
		}),
	);
});

test("run: forwards an input object shaped like RunOptions (e.g. { signal: AbortSignal }) to context.initial ([TRANSACTION-001])", async () => {
	const inputCtrl = new AbortController();
	inputCtrl.abort("domain_abort_payload");

	type SignalInput = { readonly signal: AbortSignal; };

	const transactionStep0 = Transaction.step({
		id: "inspect",
		run: () => (initial: SignalInput) =>
			Task.Result.make.ok({ sameSignal: initial.signal === inputCtrl.signal, reason: initial.signal.reason }),
	});
	const tx = Transaction.make(transactionStep0);

	const outcome = await Transaction.run(tx, { input: { signal: inputCtrl.signal } });
	expect(outcome).toStrictEqual(Result.make.ok({ inspect: { sameSignal: true, reason: "domain_abort_payload" } }));
});

test("forward: executes an empty transaction returning an empty record", async () => {
	const tx = Transaction.make();
	const outcome = await Transaction.run(tx);
	expect(outcome).toStrictEqual(Result.make.ok({}));
});
