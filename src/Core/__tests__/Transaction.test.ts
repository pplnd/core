import { expect, test } from "vitest";
import { Duration } from "../../Types/Duration.ts";
import { RetryPolicy } from "../../Types/RetryPolicy.ts";
import { TimeoutPolicy } from "../../Types/TimeoutPolicy.ts";
import { Aborted } from "../Aborted.ts";
import { Deferred } from "../Deferred.ts";
import { Result } from "../Result.ts";
import { Task } from "../Task.ts";
import { Transaction } from "../Transaction.ts";

// =============================================================================
// Validation & Construction
// =============================================================================

test("run: starts immediately and isolates input and output between runs", async () => {
	const seen: string[] = [];
	const transactionStep0 = Transaction.stepFactory<{ readonly orderId: string; }>()(
		"saved",
		({ ctx: { input: initial } }) => {
			seen.push(initial.orderId);
			return Task.Result.make.ok(initial.orderId);
		},
	);
	const transaction = Transaction.make(transactionStep0);
	const first = Transaction.run({ orderId: "first" })(transaction);
	const second = Transaction.run({ orderId: "second" })(transaction);
	expect(seen).toStrictEqual(["first", "second"]);
	const firstResult = await first;
	const secondResult = await second;
	expect(firstResult).toStrictEqual(Result.make.ok({ saved: "first" }));
	expect(secondResult).toStrictEqual(Result.make.ok({ saved: "second" }));
});

test("step: throws TypeError if id is empty", () => {
	expect(() => Transaction.step("", () => Task.Result.make.ok(1))).toThrow(TypeError);
});

test("step: throws TypeError if id is 'initial'", () => {
	expect(() =>
		// @ts-expect-error — 'initial' is reserved
		Transaction.step("initial", () => Task.Result.make.ok(1))
	).toThrow(TypeError);
});

test("step: throws TypeError when no run callback is supplied", () => {
	expect(() =>
		// @ts-expect-error — run is required
		Transaction.step("missing-run", {})
	).toThrow(TypeError);
});

test("step: throws Error on duplicate step id", () => {
	const id = (): string => "stepA";
	const first = Transaction.step(id(), () => Task.Result.make.ok(1));
	const second = Transaction.step(id(), () => Task.Result.make.ok(2));
	expect(() => Transaction.make(first, second)).toThrow(/Duplicate step id 'stepA'/);
});

test("make: rejects missing, later, and different steps with the same id", () => {
	const upload = Transaction.step("upload", () => Task.Result.make.ok("file"));
	const anotherUpload = Transaction.step("upload", () => Task.Result.make.ok("other"));
	const index = Transaction.step("index", { file: upload }, ({ deps: { file } }) => Task.Result.make.ok(file.length));
	const missing: Transaction.AnyStep<void>[] = [index];
	const later: Transaction.AnyStep<void>[] = [index, upload];
	const different: Transaction.AnyStep<void>[] = [anotherUpload, index];

	expect(() => Transaction.make(...missing)).toThrow(/Dependency 'upload' must precede step 'index'/);
	expect(() => Transaction.make(...later)).toThrow(/Dependency 'upload' must precede step 'index'/);
	expect(() => Transaction.make(...different)).toThrow(/Dependency 'upload' must precede step 'index'/);
});

test("make: validates the identity of a broadly typed dependency", async () => {
	type Order = { readonly sku: string; };
	const reserve = Transaction.stepFactory<Order>()(
		"reserve",
		({ ctx: { input: order } }) => Task.Result.make.ok(order.sku),
	);
	const other = Transaction.stepFactory<Order>()("other", ({ ctx: { input: order } }) => Task.Result.make.ok(order.sku));
	const build = (dependency: Transaction.AnyStep<Order>) => {
		const dependent = Transaction.stepFactory<Order>()(
			"dependent",
			{ dependency },
			({ ctx: { input: order }, deps: { dependency: previous } }) =>
				Task.Result.make.ok({ dependency: previous, sku: order.sku }),
		);
		return Transaction.make(reserve, dependent);
	};

	const result = await Transaction.run({ sku: "book" })(build(reserve));
	expect(result).toStrictEqual(Result.make.ok({ reserve: "book", dependent: { dependency: "book", sku: "book" } }));
	expect(() => build(other)).toThrow(/Dependency 'other' must precede step 'dependent'/);
});

test("make: supports conditional and absent dependencies without skipping validation", async () => {
	const first = Transaction.step("first", () => Task.Result.make.ok("one"));
	const other = Transaction.step("other", () => Task.Result.make.ok("two"));
	const build = (useFirst: boolean) => {
		const deps = useFirst ? { primary: first } : { alternate: other };
		const dependent = Transaction.step(
			"dependent",
			deps,
			({ deps: resolved }) => Task.Result.make.ok(resolved.primary ?? resolved.alternate),
		);
		return Transaction.make(first, dependent);
	};
	const result = await Transaction.run()(build(true));
	expect(result).toStrictEqual(Result.make.ok({ first: "one", dependent: "one" }));
	expect(() => build(false)).toThrow(/Dependency 'other' must precede step 'dependent'/);

	const optional = Transaction.step(
		"optional",
		{ skipped: undefined },
		({ deps: resolved }) => Task.Result.make.ok(Object.hasOwn(resolved, "skipped")),
	);
	const optionalResult = await Transaction.run()(Transaction.make(optional));
	expect(optionalResult).toStrictEqual(Result.make.ok({ optional: false }));
});

test("rollback: compensation receives dependency aliases and the same run input", async () => {
	type Order = { readonly customer: string; };
	const log: string[] = [];
	const upload = Transaction.stepFactory<Order>()(
		"upload",
		({ ctx: { input: order } }) => Task.Result.make.ok(`file:${order.customer}`),
	);
	const index = Transaction.stepFactory<Order>()(
		"index",
		{ file: upload },
		({ ctx: { input: order }, deps: { file } }) => Task.Result.make.ok(`${file}:${order.customer}`),
		({ ctx: { output: value, input: order }, deps: { file } }) => {
			log.push(`${value}|${file}|${order.customer}`);
			return Task.Result.make.ok(undefined);
		},
	);
	const notify = Transaction.step("notify", () => Task.Result.make.err("offline"));
	const outcome = await Transaction.run({ customer: "Mina" })(Transaction.make(upload, index, notify));

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

	const transactionStep0 = Transaction.step("first", () => {
		order.push("run:first");
		return Task.Result.make.ok(10);
	});
	const transactionStep1 = Transaction.step("second", { first: transactionStep0 }, ({ deps: ctx }) => {
		order.push(`run:second(${ctx.first})`);
		return Task.Result.make.ok(`val_${ctx.first * 2}`);
	});
	const tx = Transaction.make(transactionStep0, transactionStep1);

	const outcome = await Transaction.run()(tx);

	expect(outcome).toStrictEqual(Result.make.ok({ first: 10, second: "val_20" }));
	expect(order).toStrictEqual(["run:first", "run:second(10)"]);
});

test("forward: threads initial input and prior step outputs across all steps", async () => {
	type Input = { readonly sku: string; readonly qty: number; };

	const transactionStep0 = Transaction.stepFactory<Input>()(
		"reserve",
		({ ctx: { input: initial } }) => Task.Result.make.ok({ resId: `res_${initial.sku}_${initial.qty}` }),
	);
	const transactionStep1 = Transaction.stepFactory<Input>()(
		"charge",
		{ reserve: transactionStep0 },
		({ ctx: { input: initial }, deps: { reserve } }) =>
			Task.Result.make.ok({ chargeId: `ch_${reserve.resId}`, amount: initial.qty * 50 }),
	);
	const transactionStep2 = Transaction.stepFactory<Input>()(
		"notify",
		{ reserve: transactionStep0, charge: transactionStep1 },
		({ ctx: { input: initial }, deps: { reserve, charge } }) =>
			Task.Result.make.ok({ status: "sent", summary: `${initial.sku}: ${reserve.resId} charged ${charge.amount}` }),
	);
	const tx = Transaction.make(transactionStep0, transactionStep1, transactionStep2);

	const outcome = await Transaction.run({ sku: "widget", qty: 3 })(tx);

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

	const transactionStep0 = Transaction.stepFactory<{ readonly userId: string; }>()(
		"step1",
		({ ctx: { input: initial } }) => {
			log.push(`run:step1(${initial.userId})`);
			return Task.Result.make.ok("out1");
		},
		({ ctx: { output: out, input: initial } }) => {
			log.push(`undo:step1(${out}, initial=${initial.userId})`);
			return Task.Result.make.ok(undefined);
		},
	);
	const transactionStep1 = Transaction.stepFactory<{ readonly userId: string; }>()(
		"step2",
		{ step1: transactionStep0 },
		({ ctx: { input: _input }, deps: { step1 } }) => {
			log.push(`run:step2(${step1})`);
			return Task.Result.make.ok("out2");
		},
		({ ctx: { output: out }, deps: ctx }) => {
			log.push(`undo:step2(${out}, step1=${ctx.step1})`);
			return Task.Result.make.ok(undefined);
		},
	);
	const transactionStep2 = Transaction.stepFactory<{ readonly userId: string; }>()(
		"step3",
		({ ctx: { input: _input } }) => {
			log.push("run:step3:fails");
			return Task.Result.make.err("step3_failed");
		},
		() => {
			log.push("undo:step3:should_never_run");
			return Task.Result.make.ok(undefined);
		},
	);
	const tx = Transaction.make(transactionStep0, transactionStep1, transactionStep2);

	const outcome = await Transaction.run({ userId: "user_42" })(tx);

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

	const transactionStep0 = Transaction.step("first", () => Task.Result.make.err("first_failed"), () => {
		undoCalled = true;
		return Task.Result.make.ok(undefined);
	});
	const tx = Transaction.make(transactionStep0);

	const outcome = await Transaction.run()(tx);

	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "first", error: "first_failed", undoErrors: [] }),
	);
	expect(undoCalled).toBe(false);
});

test("rollback: steps without undo are safely skipped during LIFO drainage", async () => {
	const rollbacks: string[] = [];

	const transactionStep0 = Transaction.step("s1", () => Task.Result.make.ok("v1"), () => {
		rollbacks.push("s1");
		return Task.Result.make.ok(undefined);
	});
	const transactionStep1 = Transaction.step("s2", () => Task.Result.make.ok("v2"));
	const transactionStep2 = Transaction.step("s3", () => Task.Result.make.ok("v3"), () => {
		rollbacks.push("s3");
		return Task.Result.make.ok(undefined);
	});
	const transactionStep3 = Transaction.step("s4", () => Task.Result.make.err("s4_failed"));
	const tx = Transaction.make(transactionStep0, transactionStep1, transactionStep2, transactionStep3);

	const outcome = await Transaction.run()(tx);

	expect(Result.is.err(outcome)).toBe(true);
	expect(rollbacks).toStrictEqual(["s3", "s1"]);
});

// =============================================================================
// Fault Handling in Undo (Best-Effort Drain & Attribution)
// =============================================================================

test("rollback: continues draining remaining undos when intermediate undos return errors", async () => {
	const log: string[] = [];

	const transactionStep0 = Transaction.step("step1", () => Task.Result.make.ok(1), () => {
		log.push("undo:step1");
		return Task.Result.make.ok(undefined);
	});
	const transactionStep1 = Transaction.step("step2", () => Task.Result.make.ok(2), () => {
		log.push("undo:step2_fails");
		return Task.Result.make.err("step2_undo_err");
	});
	const transactionStep2 = Transaction.step("step3", () => Task.Result.make.ok(3), () => {
		log.push("undo:step3_fails");
		return Task.Result.make.err("step3_undo_err");
	});
	const transactionStep3 = Transaction.step("step4", () => {
		log.push("run:step4_fails");
		return Task.Result.make.err("forward_failure");
	});
	const tx = Transaction.make(transactionStep0, transactionStep1, transactionStep2, transactionStep3);

	const outcome = await Transaction.run()(tx);

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

	const transactionStep0 = Transaction.step("s1", () => {
		stepExecuted = true;
		return Task.Result.make.ok("v1");
	});
	const tx = Transaction.make(transactionStep0);

	const outcome = await Transaction.run(undefined, { signal: controller.signal })(tx);

	expect(stepExecuted).toBe(false);
	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "s1", error: Aborted.make(expect.any(Error)), undoErrors: [] }),
	);
});

test("abort: triggers LIFO rollback of completed steps when aborted mid-flight", async () => {
	const controller = new AbortController();
	const log: string[] = [];

	const transactionStep0 = Transaction.step("s1", () => {
		log.push("run:s1");
		return Task.Result.make.ok("v1");
	}, () => {
		log.push("undo:s1");
		return Task.Result.make.ok(undefined);
	});
	const transactionStep1 = Transaction.step("s2", () => {
		log.push("run:s2:aborting");
		controller.abort(new Error("mid_flight_abort"));
		return Task.Result.make.ok("v2");
	}, () => {
		log.push("undo:s2");
		return Task.Result.make.ok(undefined);
	});
	const transactionStep2 = Transaction.step("s3", () => {
		log.push("run:s3:should_not_run");
		return Task.Result.make.ok("v3");
	});
	const tx = Transaction.make(transactionStep0, transactionStep1, transactionStep2);

	const outcome = await Transaction.run(undefined, { signal: controller.signal })(tx);

	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "s3", error: Aborted.make(expect.any(Error)), undoErrors: [] }),
	);

	expect(log).toStrictEqual(["run:s1", "run:s2:aborting", "undo:s2", "undo:s1"]);
});

// =============================================================================
// Resilience: RetryPolicy and Timeout
// =============================================================================

test("retry: transient step failure retries up to policy attempts and succeeds without rollback", async () => {
	let attempts = 0;
	let undoCalled = false;

	const transactionStep0 = Transaction.step(
		"transientStep",
		() =>
			Task.Result.retry(RetryPolicy.constant({ attempts: 3, delay: Duration.milliseconds(5) }))((signal) => {
				attempts++;
				if (attempts < 3) {
					return Task.Result.make.err("transient_err")(signal);
				}
				return Task.Result.make.ok("recovered")(signal);
			}),
		() => {
			undoCalled = true;
			return Task.Result.make.ok(undefined);
		},
	);
	const tx = Transaction.make(transactionStep0);

	const outcome = await Transaction.run()(tx);

	expect(outcome).toStrictEqual(Result.make.ok({ transientStep: "recovered" }));
	expect(attempts).toBe(3);
	expect(undoCalled).toBe(false);
});

test("retry: step failure that exhausts retries initiates LIFO rollback", async () => {
	let attempts = 0;
	const log: string[] = [];

	const transactionStep0 = Transaction.step("step1", () => Task.Result.make.ok("s1_ok"), () => {
		log.push("undo:step1");
		return Task.Result.make.ok(undefined);
	});
	const transactionStep1 = Transaction.step(
		"step2",
		() =>
			Task.Result.retry(RetryPolicy.constant({ attempts: 2, delay: Duration.milliseconds(5) }))((signal) => {
				attempts++;
				return Task.Result.make.err(`retry_err_${attempts}`)(signal);
			}),
	);
	const tx = Transaction.make(transactionStep0, transactionStep1);

	const outcome = await Transaction.run()(tx);

	expect(attempts).toBe(2);
	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "step2", error: "retry_err_2", undoErrors: [] }),
	);
	expect(log).toStrictEqual(["undo:step1"]);
});

test("timeout: forward step exceeding timeout duration fails and rolls back", async () => {
	const log: string[] = [];

	const transactionStep0 = Transaction.step("step1", () => Task.Result.make.ok("s1_ok"), () => {
		log.push("undo:step1");
		return Task.Result.make.ok(undefined);
	});
	const transactionStep1 = Transaction.step(
		"slowStep",
		() =>
			Task.Result.timeout(TimeoutPolicy.after({ duration: Duration.milliseconds(10), onTimeout: () => "timed_out" }))(() =>
				Deferred.from.Promise(
					new Promise<Result<never, string>>((resolve) => {
						setTimeout(() => resolve(Result.make.ok("too_late")), 50);
					}),
				)
			),
	);
	const tx = Transaction.make(transactionStep0, transactionStep1);

	const outcome = await Transaction.run()(tx);

	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "slowStep", error: "timed_out", undoErrors: [] }),
	);
	expect(log).toStrictEqual(["undo:step1"]);
});

test("timeout: aborts the task before compensation and leaves undo uncancelled", async () => {
	const events: string[] = [];
	const reserve = Transaction.step("reserve", () => Task.Result.make.ok("reserved"), () => (signal) => {
		events.push(signal === undefined ? "undo:uncancelled" : "undo:signal");
		return Task.Result.make.ok(undefined)(signal);
	});
	const upload = Transaction.step(
		"upload",
		() =>
			Task.Result.timeout(TimeoutPolicy.after({ duration: Duration.milliseconds(5), onTimeout: () => "timed_out" }))(
				Task.Result.tryCatch((signal) =>
					new Promise<string>((_resolve, reject) => {
						signal?.addEventListener("abort", () => {
							events.push("upload:aborted");
							reject(new Error("aborted"));
						}, { once: true });
					}), { onError: String }),
			),
	);
	const outcome = await Transaction.run()(Transaction.make(reserve, upload));
	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "upload", error: "timed_out", undoErrors: [] }),
	);
	expect(events).toStrictEqual(["upload:aborted", "undo:uncancelled"]);
});

// =============================================================================
// Telemetry Hooks & Exception Isolation
// =============================================================================

test("telemetry: fires onStepSuccess, onStepFailure, and onUndo hooks", async () => {
	const successes: Array<{ stepId: string; output: unknown; }> = [];
	const failures: Array<{ stepId: string; error: unknown; }> = [];
	const undos: Array<{ stepId: string; error?: unknown; }> = [];

	const transactionStep0 = Transaction.step(
		"s1",
		() => Task.Result.make.ok("val1"),
		() => Task.Result.make.ok(undefined),
	);
	const transactionStep1 = Transaction.step(
		"s2",
		() => Task.Result.make.err("fail2"),
		() => Task.Result.make.ok(undefined),
	);
	const tx = Transaction.make(transactionStep0, transactionStep1);

	await Transaction.run()(
		Transaction.observe(tx, {
			onStepSuccess: (meta) => successes.push(meta),
			onStepFailure: (meta) => failures.push(meta),
			onUndo: (meta) => undos.push(meta),
		}),
	);

	expect(successes).toStrictEqual([{ stepId: "s1", output: "val1" }]);
	expect(failures).toStrictEqual([{ stepId: "s2", error: "fail2" }]);
	expect(undos).toStrictEqual([{ stepId: "s1" }]);
});

test("telemetry: fires onUndo with the error when undo fails", async () => {
	const undos: Array<{ stepId: string; error?: unknown; }> = [];

	const transactionStep0 = Transaction.step(
		"s1",
		() => Task.Result.make.ok("v1"),
		() => Task.Result.make.err("undo_failed_err"),
	);
	const transactionStep1 = Transaction.step("s2", () => Task.Result.make.err("step2_fail"));
	const tx = Transaction.make(transactionStep0, transactionStep1);

	const outcome = await Transaction.run()(Transaction.observe(tx, {
		onUndo: (meta) => {
			undos.push(meta);
		},
	}));

	expect(Result.is.err(outcome)).toBe(true);
	expect(undos).toStrictEqual([{ stepId: "s1", error: "undo_failed_err" }]);
});

test("signals: aborts a running transaction through the run signal", async () => {
	const callerCtrl = new AbortController();

	const transactionStep0 = Transaction.step("s1", () => Task.Result.make.ok("v1"));
	const transactionStep1 = Transaction.step("s2", () => {
		callerCtrl.abort(new Error("caller_abort"));
		return Task.Result.make.ok("v2");
	});
	const transactionStep2 = Transaction.step("s3", () => Task.Result.make.ok("v3"));
	const tx = Transaction.make(transactionStep0, transactionStep1, transactionStep2);

	const outcome = await Transaction.run(undefined, { signal: callerCtrl.signal })(tx);

	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "s3", error: Aborted.make(expect.any(Error)), undoErrors: [] }),
	);
});

test("observe: attaches telemetry when the transaction takes no input", async () => {
	let succeeded = false;
	const transactionStep0 = Transaction.step("s1", () => Task.Result.make.ok("v1"));
	const tx = Transaction.make(transactionStep0);
	const audited = Transaction.observe(tx, {
		onStepSuccess: () => {
			succeeded = true;
		},
	});
	const outcome = await Transaction.run()(audited);
	expect(Result.is.ok(outcome)).toBe(true);
	expect(succeeded).toBe(true);
});

test("observe: attaching telemetry twice replaces the previous hooks", async () => {
	const first: string[] = [];
	const second: string[] = [];
	const transactionStep0 = Transaction.step("s1", () => Task.Result.make.ok("v1"));
	const tx = Transaction.make(transactionStep0);
	const audited = Transaction.observe(tx, { onStepSuccess: () => first.push("first") });
	const replaced = Transaction.observe(audited, { onStepSuccess: () => second.push("second") });

	await Transaction.run()(replaced);

	expect(first).toStrictEqual([]);
	expect(second).toStrictEqual(["second"]);
});

test("run: returns initial stepId when empty transaction is aborted prior to execution", async () => {
	const ctrl = new AbortController();
	ctrl.abort(new Error("aborted_empty"));
	const tx = Transaction.make();
	const outcome = await Transaction.run(undefined, { signal: ctrl.signal })(tx);
	expect(outcome).toStrictEqual(
		Result.make.err({
			kind: "TransactionFailure",
			stepId: "initial",
			error: Aborted.make(expect.any(Error)),
			undoErrors: [],
		}),
	);
});

test("run: preserves a null signal reason before execution", async () => {
	const ctrl = new AbortController();
	ctrl.abort(null);
	const tx = Transaction.make();
	const outcome = await Transaction.run(undefined, { signal: ctrl.signal })(tx);
	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "initial", error: Aborted.make(null), undoErrors: [] }),
	);
});

test("run: preserves a null signal reason between steps", async () => {
	const ctrl = new AbortController();

	const transactionStep0 = Transaction.step("s1", () => {
		ctrl.abort(null);
		return Task.Result.make.ok("v1");
	});
	const transactionStep1 = Transaction.step("s2", () => Task.Result.make.ok("v2"));
	const tx = Transaction.make(transactionStep0, transactionStep1);

	const outcome = await Transaction.run(undefined, { signal: ctrl.signal })(tx);
	expect(outcome).toStrictEqual(
		Result.make.err({ kind: "TransactionFailure", stepId: "s2", error: Aborted.make(null), undoErrors: [] }),
	);
});

test("run: forwards an input object shaped like RunOptions (e.g. { signal: AbortSignal }) to context.initial", async () => {
	const inputCtrl = new AbortController();
	const runCtrl = new AbortController();
	inputCtrl.abort("domain_abort_payload");

	type SignalInput = { readonly signal: AbortSignal; };

	const transactionStep0 = Transaction.stepFactory<SignalInput>()(
		"inspect",
		({ ctx: { input: initial } }) => (signal) =>
			Task.Result.make.ok({
				sameSignal: initial.signal === inputCtrl.signal,
				runSignal: signal === runCtrl.signal,
				reason: initial.signal.reason,
			})(signal),
	);
	const tx = Transaction.make(transactionStep0);

	const outcome = await Transaction.run({ signal: inputCtrl.signal }, { signal: runCtrl.signal })(tx);
	expect(outcome).toStrictEqual(
		Result.make.ok({ inspect: { sameSignal: true, runSignal: true, reason: "domain_abort_payload" } }),
	);
});

test("forward: executes an empty transaction returning an empty record", async () => {
	const tx = Transaction.make();
	const outcome = await Transaction.run()(tx);
	expect(outcome).toStrictEqual(Result.make.ok({}));
});

test("stepFactory: creates reusable steps with per-run input and compensation", async () => {
	type Input = { name: string; };
	const events: string[] = [];
	const step = Transaction.stepFactory<Input>();
	const upload = step("upload", ({ ctx: { input } }) => {
		events.push(`upload:${input.name}`);
		return Task.Result.make.ok(input.name);
	}, ({ ctx: { output: name } }) => {
		events.push(`undo:${name}`);
		return Task.Result.make.ok(undefined);
	});
	const fail = step("index", { upload }, ({ deps: { upload: name } }) => {
		events.push(`index:${name}`);
		return Task.Result.make.err("unavailable");
	});
	const publish = Transaction.make(upload, fail);
	const uploadOnly = Transaction.make(upload);
	const failed = await Transaction.run({ name: "report.pdf" })(publish);
	expect(Result.is.err(failed)).toBe(true);
	expect(events).toStrictEqual(["upload:report.pdf", "index:report.pdf", "undo:report.pdf"]);
	const success = await Transaction.run({ name: "other.pdf" })(uploadOnly);
	expect(success).toStrictEqual(Result.make.ok({ upload: "other.pdf" }));
});
