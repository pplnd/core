import { constTruthyBool } from "#test-utils";
import { expectTypeOf, test } from "vitest";
import { Duration } from "../../Types/Duration.ts";
import { RetryPolicy } from "../../Types/RetryPolicy.ts";
import type { Aborted } from "../Aborted.ts";
import type { Deferred } from "../Deferred.ts";
import type { Result } from "../Result.ts";
import { Task } from "../Task.ts";
import { Transaction } from "../Transaction.ts";

type Order = { readonly sku: string; readonly quantity: number; };
type Reservation = { readonly id: string; readonly total: number; };
type Payment = { readonly id: string; };

test("step: infers dependencies, input, output and compensation", () => {
	const reservation = Transaction.stepFactory<Order>()(
		"reservation",
		({ ctx: { input: order } }) =>
			constTruthyBool()
				? Task.Result.make.ok({ id: order.sku, total: order.quantity })
				: Task.Result.make.err("inventory_error"),
		({ ctx: { output: value } }) => {
			expectTypeOf(value).toMatchTypeOf<Reservation>();
			return Task.Result.make.err("release_error");
		},
	);
	const payment = Transaction.stepFactory<Order>()(
		"payment",
		{ reserved: reservation },
		({ ctx: { input: order }, deps: { reserved } }) => {
			expectTypeOf(reserved).toMatchTypeOf<Reservation>();
			expectTypeOf(order).toEqualTypeOf<Order>();
			return Task.Result.timeout({ duration: Duration.seconds(2), onTimeout: (): "payment_timeout" => "payment_timeout" })(
				Task.Result.retry(RetryPolicy.constant({ attempts: 2, delay: Duration.milliseconds(1) }))(
					constTruthyBool()
						? Task.Result.make.ok({ id: `${reserved.id}:${order.sku}` })
						: Task.Result.make.err("charge_error"),
				),
			);
		},
		({ ctx: { output: value, input }, deps }) => {
			expectTypeOf(value).toMatchTypeOf<Payment>();
			expectTypeOf(deps.reserved).toMatchTypeOf<Reservation>();
			expectTypeOf(input).toEqualTypeOf<Order>();
			return Task.Result.make.ok(undefined);
		},
	);
	const tx = Transaction.make(reservation, payment);
	const result = Transaction.run({ sku: "book", quantity: 2 })(tx);
	type Outcome = Awaited<typeof result>;
	type Failure = Extract<Outcome, Result.Err<unknown>>["error"];
	type Outputs = Extract<Outcome, Result.Ok<unknown>>["value"];
	expectTypeOf<Failure>().toEqualTypeOf<
		Transaction.Failure<"inventory_error" | "charge_error" | "payment_timeout" | Aborted, "release_error">
	>();
	expectTypeOf<Outputs["reservation"]>().toEqualTypeOf<{ id: string; total: number; }>();
	expectTypeOf<Outputs["payment"]>().toEqualTypeOf<{ id: string; }>();
	expectTypeOf(result).toMatchTypeOf<
		Deferred<
			Result<
				Transaction.Failure<"inventory_error" | "charge_error" | "payment_timeout" | Aborted, "release_error">,
				{ readonly reservation: Reservation; readonly payment: Payment; }
			>
		>
	>();

	// @ts-expect-error — a run must supply the input required by its steps
	Transaction.run()(tx);
	// @ts-expect-error — the transaction input must satisfy the order contract
	Transaction.run({ sku: "book" })(tx);
	// @ts-expect-error — a dependency must occur before the dependent step
	Transaction.make(payment, reservation);
	// @ts-expect-error — a dependency must be included in the transaction
	Transaction.make(payment);
	// @ts-expect-error — step IDs must be unique
	Transaction.make(reservation, reservation);

	const unrelated = Transaction.step("unrelated", () => Task.Result.make.ok("unused"));
	const dependent = Transaction.step("dependent", { reservation, unrelated }, () => Task.Result.make.ok(undefined));
	// @ts-expect-error — each dependency must appear in the transaction
	Transaction.make(reservation, dependent);
});

test("make: no-input and dynamic step lists preserve input requirements", () => {
	const upload = Transaction.step("upload", () => Task.Result.make.ok("file"));
	const index = Transaction.step("index", { file: upload }, ({ deps: { file } }) => Task.Result.make.ok(file.length));
	const noInput = Transaction.make(upload, index);
	expectTypeOf(Transaction.run()(noInput)).toEqualTypeOf<
		Deferred<Result<Transaction.Failure<Aborted, never>, { readonly upload: string; readonly index: number; }>>
	>();
	// @ts-expect-error — no-input transactions do not accept an input
	Transaction.run("unexpected")(noInput);

	const lookup = Transaction.stepFactory<Order>()(
		"lookup",
		({ ctx: { input: order } }) => Task.Result.make.ok(order.sku),
	);
	const steps = [upload, lookup];
	const dynamic = Transaction.make(...steps);
	Transaction.run({ sku: "book", quantity: 1 })(dynamic);
	// @ts-expect-error — dynamic collections retain required input types
	Transaction.run()(dynamic);

	const explicitlyTyped: Transaction.AnyStep<Order>[] = [upload, lookup];
	const typedDynamic = Transaction.make(...explicitlyTyped);
	Transaction.run({ sku: "book", quantity: 1 })(typedDynamic);
	// @ts-expect-error — an explicitly typed dynamic collection retains its input requirement
	Transaction.run()(typedDynamic);
});

test("run: domain input shaped like options is passed unchanged", () => {
	type SignalInput = { readonly signal: AbortSignal; };
	const inspect = Transaction.stepFactory<SignalInput>()("inspect", ({ ctx: { input } }) => {
		expectTypeOf(input.signal).toEqualTypeOf<AbortSignal>();
		return Task.Result.make.ok(input.signal.aborted);
	});
	const tx = Transaction.make(inspect);
	const controller = new AbortController();
	expectTypeOf(Transaction.run<SignalInput>({ signal: controller.signal })(tx)).toEqualTypeOf<
		Deferred<Result<Transaction.Failure<Aborted, never>, { readonly inspect: boolean; }>>
	>();
});

test("make: combines independent input requirements without losing either", () => {
	const inventoryStep = Transaction.stepFactory<{ readonly sku: string; }>()(
		"inventory",
		({ ctx: { input } }) => Task.Result.make.ok(input.sku),
	);
	const payment = Transaction.stepFactory<{ readonly customerId: string; }>()(
		"payment",
		{ inventory: inventoryStep },
		({ ctx: { input }, deps: { inventory } }) => Task.Result.make.ok(`${inventory}:${input.customerId}`),
	);
	const tx = Transaction.make(inventoryStep, payment);
	expectTypeOf(Transaction.run({ sku: "book", customerId: "mina" })(tx)).toBeObject();
	// @ts-expect-error — the payment step also requires a customer ID
	Transaction.run({ sku: "book" })(tx);
});

test("make: accepts a dependency exposed through the supported broad step type", () => {
	const reserve = Transaction.stepFactory<Order>()(
		"reserve",
		({ ctx: { input: order } }) => Task.Result.make.ok(order.sku),
	);
	const build = (dependency: Transaction.AnyStep<Order>) => {
		const dependent = Transaction.stepFactory<Order>()(
			"dependent",
			{ dependency },
			({ ctx: { input: order }, deps: { dependency: previous } }) =>
				Task.Result.make.ok({ dependency: previous, sku: order.sku }),
		);
		return Transaction.make(reserve, dependent);
	};
	const tx = build(reserve);
	expectTypeOf(Transaction.run({ sku: "book", quantity: 1 })(tx)).toBeObject();
	// @ts-expect-error — broad dependencies do not remove the transaction input requirement
	Transaction.run()(tx);
});

test("make: allows a dependency whose union type can refer to an earlier step", () => {
	const first = Transaction.step("first", () => Task.Result.make.ok("one"));
	const other = Transaction.step("other", () => Task.Result.make.ok("two"));
	const dependency = constTruthyBool() ? first : other;
	const dependent = Transaction.step(
		"dependent",
		{ dependency },
		({ deps: { dependency: value } }) => Task.Result.make.ok(value.toUpperCase()),
	);
	const transaction = Transaction.make(first, dependent);
	expectTypeOf(Transaction.run()(transaction)).toBeObject();
});

test("make: supports conditional dependency records and accurately types absent entries", () => {
	const first = Transaction.step("first", () => Task.Result.make.ok("one"));
	const other = Transaction.step("other", () => Task.Result.make.ok("two"));
	const deps = constTruthyBool() ? { primary: first } : { alternate: other };
	const dependent = Transaction.step("dependent", deps, ({ deps: resolved }) => {
		expectTypeOf(resolved.primary).toEqualTypeOf<string | undefined>();
		expectTypeOf(resolved.alternate).toEqualTypeOf<string | undefined>();
		return Task.Result.make.ok(resolved.primary ?? resolved.alternate);
	});
	expectTypeOf(Transaction.make(first, dependent)).toBeObject();
	const missingVariant = Transaction.step(
		"missingVariant",
		constTruthyBool() ? { firstMissing: other } : { secondMissing: other },
		() => Task.Result.make.ok(undefined),
	);
	// @ts-expect-error — neither dependency variant can refer to the supplied earlier step
	Transaction.make(first, missingVariant);

	const optional = Transaction.step("optional", { skipped: undefined }, ({ deps: resolved }) => {
		expectTypeOf(resolved.skipped).toEqualTypeOf<undefined>();
		return Task.Result.make.ok(undefined);
	});
	expectTypeOf(Transaction.make(optional)).toBeObject();
});

test("step: rejects reserved identifiers", () => {
	// @ts-expect-error — the reserved identifier is not available for a step
	const invalid = Transaction.step("initial", () => Task.Result.make.ok(1));
	expectTypeOf(invalid).toBeObject();
});

test("stepFactory: shares an input contract while inferring dependencies and compensation", () => {
	type Input = { readonly name: string; };
	const step = Transaction.stepFactory<Input>();
	const upload = step("upload", ({ ctx: { input } }) => Task.Result.make.ok(input.name), ({ ctx: { output: name } }) => {
		expectTypeOf(name).toEqualTypeOf<string>();
		return Task.Result.make.ok(undefined);
	});
	const index = step("index", { upload }, ({ ctx: { input }, deps: { upload: file } }) => {
		expectTypeOf(input).toEqualTypeOf<Input>();
		expectTypeOf(file).toEqualTypeOf<string>();
		return Task.Result.make.ok(file.length);
	});
	const audit = Transaction.step("audit", () => Task.Result.make.ok(true));
	const publish = Transaction.make(upload, index, audit);
	const uploadOnly = Transaction.make(upload);
	expectTypeOf(Transaction.run({ name: "report" })(publish)).toEqualTypeOf<
		Deferred<
			Result<
				Transaction.Failure<Aborted, never>,
				{ readonly upload: string; readonly index: number; readonly audit: boolean; }
			>
		>
	>();
	Transaction.run({ name: "report" })(uploadOnly);
	// @ts-expect-error A run requires the contract's name.
	Transaction.run({})(publish);
});

test("stepFactory: exposes input and dependency outputs to run and output to undo", () => {
	type Input = { readonly name: string; };
	const step = Transaction.stepFactory<Input>();
	const upload = step("upload", ({ ctx }) => {
		expectTypeOf(ctx.input).toEqualTypeOf<Input>();
		// @ts-expect-error The step has not produced an output yet.
		expectTypeOf(ctx.output).toBeNever();
		return Task.Result.make.ok(ctx.input.name);
	}, ({ ctx }) => {
		expectTypeOf(ctx.input).toEqualTypeOf<Input>();
		expectTypeOf(ctx.output).toEqualTypeOf<string>();
		return Task.Result.make.err("undo_failed");
	});
	const index = step("index", { upload }, ({ ctx, deps }) => Task.Result.make.ok(`${ctx.input.name}:${deps.upload}`));
	expectTypeOf(upload.id).toEqualTypeOf<"upload">();
	expectTypeOf(Transaction.run({ name: "report" })(Transaction.make(upload, index))).toEqualTypeOf<
		Deferred<Result<Transaction.Failure<Aborted, "undo_failed">, { readonly upload: string; readonly index: string; }>>
	>();
});

test("stepFactory: preserves forward and timeout errors when a task is retried", () => {
	const step = Transaction.stepFactory<{ readonly name: string; }>();
	const upload = step(
		"upload",
		({ ctx }) => constTruthyBool() ? Task.Result.make.ok(ctx.input.name) : Task.Result.make.err("upload_failed"),
	);
	const index = step(
		"index",
		{ upload },
		({ deps }) =>
			Task.Result.timeout({ duration: Duration.seconds(1), onTimeout: (): "timeout" => "timeout" })(
				Task.Result.retry(RetryPolicy.exponential({ attempts: 3, initial: Duration.milliseconds(10) }))(
					Task.Result.make.ok(deps.upload.length),
				),
			),
	);
	expectTypeOf(Transaction.run({ name: "report" })(Transaction.make(upload, index))).toEqualTypeOf<
		Deferred<
			Result<
				Transaction.Failure<"upload_failed" | "timeout" | Aborted, never>,
				{ readonly upload: string; readonly index: number; }
			>
		>
	>();
});

test("step: positional compensation and dependencies preserve inferred channels", () => {
	type Input = { readonly id: string; };
	const factory = Transaction.stepFactory<Input>();
	const load = factory("load", ({ ctx }) => Task.Result.make.ok(ctx.input.id), ({ ctx }) => {
		expectTypeOf(ctx.output).toEqualTypeOf<string>();
		return Task.Result.make.ok(undefined);
	});

	type LoadOut = typeof load extends Transaction.Step<any, any, any, infer Out, any, any> ? Out : never;
	expectTypeOf<LoadOut>().toEqualTypeOf<string>();

	const base = Transaction.step("base", () => Task.Result.make.ok(1));
	const dependent = Transaction.step("dependent", { base }, ({ deps }) => {
		expectTypeOf(deps.base).toEqualTypeOf<number>();
		return Task.Result.make.ok("ok");
	});
	type DependentOut = typeof dependent extends Transaction.Step<any, any, any, infer Out, any, any> ? Out : never;
	expectTypeOf<DependentOut>().toEqualTypeOf<string>();
});

test("run: telemetry options are typed independently of the transaction error channel", () => {
	const step = Transaction.step("load", () => Task.Result.make.err("load_failed"));
	const tx = Transaction.make(step);
	expectTypeOf(Transaction.run()(tx)).toEqualTypeOf<
		Deferred<Result<Transaction.Failure<"load_failed" | Aborted, never>, { readonly load: never; }>>
	>();
	Transaction.run(undefined, {
		onStepFailure: (metadata: { readonly stepId: string; readonly error: unknown; }) => {
			expectTypeOf(metadata.error).toEqualTypeOf<unknown>();
		},
		onUndo: (metadata: { readonly stepId: string; readonly error?: unknown; }) => {
			expectTypeOf(metadata.error).toEqualTypeOf<unknown>();
		},
	})(tx);
});
