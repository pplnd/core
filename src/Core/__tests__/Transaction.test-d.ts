import { expectTypeOf, test } from "vitest";
import { pipe } from "../../Composition/pipe.ts";
import { Duration } from "../../Types/Duration.ts";
import { RetryPolicy } from "../../Types/RetryPolicy.ts";
import { Task } from "../Task.ts";
import { Transaction } from "../Transaction.ts";

type OrderInput = { readonly sku: string; readonly qty: number; };
type Reservation = { readonly resId: string; };
type Payment = { readonly chargeId: string; };

test("make: infers empty transaction with default void or explicit input", () => {
	const defaultTx = Transaction.make();
	expectTypeOf(defaultTx).toEqualTypeOf<Transaction<void, Record<never, never>, never, never>>();

	const inputTx = Transaction.make<OrderInput>();
	expectTypeOf(inputTx).toEqualTypeOf<Transaction<OrderInput, Record<never, never>, never, never>>();
});

test("step & pipe: contextually accumulates step outputs and unions forward and undo errors", () => {
	const tx = pipe(
		Transaction.make<OrderInput>(),
		Transaction.step({
			id: "reservation",
			run: (ctx) => {
				expectTypeOf(ctx.initial).toEqualTypeOf<OrderInput>();
				return Task.Result.make.ok<Reservation>({ resId: "r1" });
			},
			undo: (res, ctx) => {
				expectTypeOf(res).toEqualTypeOf<Reservation>();
				expectTypeOf(ctx.initial.sku).toBeString();
				return Task.Result.make.err<"undo_res_err">("undo_res_err");
			},
		}),
		Transaction.step({
			id: "payment",
			retry: RetryPolicy.constant({ attempts: 3, delay: Duration.milliseconds(10) }),
			timeout: { duration: Duration.seconds(5), onTimeout: () => "payment_timeout" as const },
			run: (ctx) => {
				expectTypeOf(ctx.initial).toEqualTypeOf<OrderInput>();
				expectTypeOf(ctx.reservation).toEqualTypeOf<Reservation>();
				return Task.Result.make.ok<Payment>({ chargeId: "c1" });
			},
			undo: (pay, ctx) => {
				expectTypeOf(pay).toEqualTypeOf<Payment>();
				expectTypeOf(ctx.reservation.resId).toBeString();
				return Task.Result.make.ok<void>(undefined);
			},
		}),
		Transaction.step({
			id: "shipment",
			run: (ctx) => {
				expectTypeOf(ctx.initial.sku).toBeString();
				expectTypeOf(ctx.reservation.resId).toBeString();
				expectTypeOf(ctx.payment.chargeId).toBeString();
				return Task.Result.make.err<"shipment_err">("shipment_err");
			},
		}),
	);

	type InferredAcc = typeof tx extends Transaction<any, infer Acc, any, any> ? Acc : never;
	expectTypeOf<InferredAcc["reservation"]>().toEqualTypeOf<Reservation>();
	expectTypeOf<InferredAcc["payment"]>().toEqualTypeOf<Payment>();
	expectTypeOf<InferredAcc["shipment"]>().toEqualTypeOf<never>();

	type InferredE = typeof tx extends Transaction<any, any, infer E, any> ? E : never;
	expectTypeOf<InferredE>().toEqualTypeOf<"payment_timeout" | "shipment_err">();

	type InferredUndoE = typeof tx extends Transaction<any, any, any, infer EUndo> ? EUndo : never;
	expectTypeOf<InferredUndoE>().toEqualTypeOf<"undo_res_err">();
});

test("run: returns Task.Result resolving to Result with exact Acc and Failure types", () => {
	const tx = pipe(
		Transaction.make<OrderInput>(),
		Transaction.step({
			id: "stepA",
			run: () => Task.Result.make.ok<number>(42),
			undo: () => Task.Result.make.err<"undo_err">("undo_err"),
		}),
		Transaction.step({ id: "stepB", run: () => Task.Result.make.err<"run_err">("run_err") }),
	);

	const runner = Transaction.run({ sku: "item", qty: 2 })(tx);
	expectTypeOf(runner).toBeFunction();

	type RunnerOutcome = typeof runner extends Task.Result<infer E, infer Acc> ? { E: E; Acc: Acc; } : never;
	expectTypeOf<RunnerOutcome["E"]>().toEqualTypeOf<Transaction.Failure<"run_err", "undo_err">>();
	expectTypeOf<RunnerOutcome["Acc"]["stepA"]>().toEqualTypeOf<number>();
	expectTypeOf<RunnerOutcome["Acc"]["stepB"]>().toEqualTypeOf<never>();
});

test("run: void transaction allows invocation without input argument", () => {
	const voidTx = pipe(Transaction.make(), Transaction.step({ id: "init", run: () => Task.Result.make.ok("done") }));

	const runner = Transaction.run()(voidTx);
	expectTypeOf(runner).toBeFunction();

	type VoidOutcome = typeof runner extends Task.Result<infer E, infer Acc> ? { E: E; Acc: Acc; } : never;
	expectTypeOf<VoidOutcome["E"]>().toEqualTypeOf<Transaction.Failure<never, never>>();
	expectTypeOf<VoidOutcome["Acc"]["init"]>().toEqualTypeOf<string>();
});

test("negative: disallows duplicate step IDs", () => {
	const tx = pipe(
		Transaction.make(),
		Transaction.step({ id: "duplicateKey", run: () => Task.Result.make.ok(1) }),
		Transaction.step({
			// @ts-expect-error — duplicate step id is not assignable to never
			id: "duplicateKey",
			run: () => Task.Result.make.ok(2),
		}),
	);
	expectTypeOf(tx).toBeObject();
});

test("negative: disallows 'initial' as a step ID", () => {
	const tx = pipe(
		Transaction.make(),
		Transaction.step({
			// @ts-expect-error — 'initial' is reserved
			id: "initial",
			run: () => Task.Result.make.ok(1),
		}),
	);
	expectTypeOf(tx).toBeObject();
});

test("negative: requires valid input when In is not void", () => {
	const tx = Transaction.make<OrderInput>();

	// @ts-expect-error — runner expecting void transaction cannot run OrderInput transaction
	Transaction.run()(tx);

	// @ts-expect-error — invalid input structure
	Transaction.run({ wrongKey: "bad" })(tx);

	expectTypeOf(tx).toBeObject();
});
