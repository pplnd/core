import { constTruthyBool } from "#test-utils";
import { expectTypeOf, test } from "vitest";
import { Duration } from "../../Types/Duration.ts";
import { RetryPolicy } from "../../Types/RetryPolicy.ts";
import type { Deferred } from "../Deferred.ts";
import type { Result } from "../Result.ts";
import { Task } from "../Task.ts";
import { Transaction } from "../Transaction.ts";

type Order = { readonly sku: string; readonly quantity: number; };
type Reservation = { readonly id: string; readonly total: number; };
type Payment = { readonly id: string; };

test("step: infers dependencies, input, output and compensation", () => {
	const reservation = Transaction.step({
		id: "reservation",
		run: () => (order: Order) =>
			constTruthyBool()
				? Task.Result.make.ok({ id: order.sku, total: order.quantity })
				: Task.Result.make.err("inventory_error"),
		undo: (value) => {
			expectTypeOf(value).toMatchTypeOf<Reservation>();
			return Task.Result.make.err("release_error");
		},
	});
	const payment = Transaction.step({
		id: "payment",
		deps: { reserved: reservation },
		retry: RetryPolicy.constant({ attempts: 2, delay: Duration.milliseconds(1) }),
		timeout: { duration: Duration.seconds(2), onTimeout: (): "payment_timeout" => "payment_timeout" },
		run: ({ reserved }) => (order: Order) => {
			expectTypeOf(reserved).toMatchTypeOf<Reservation>();
			expectTypeOf(order).toEqualTypeOf<Order>();
			return constTruthyBool()
				? Task.Result.make.ok({ id: `${reserved.id}:${order.sku}` })
				: Task.Result.make.err("charge_error");
		},
		undo: (value, deps, input) => {
			expectTypeOf(value).toMatchTypeOf<Payment>();
			expectTypeOf(deps.reserved).toMatchTypeOf<Reservation>();
			expectTypeOf(input).toEqualTypeOf<Order>();
			return Task.Result.make.ok(undefined);
		},
	});
	const tx = Transaction.make(reservation, payment);
	const result = Transaction.run(tx, { input: { sku: "book", quantity: 2 } });
	type Outcome = Awaited<typeof result>;
	type Failure = Extract<Outcome, Result.Err<unknown>>["error"];
	type Outputs = Extract<Outcome, Result.Ok<unknown>>["value"];
	expectTypeOf<Failure>().toEqualTypeOf<
		Transaction.Failure<"inventory_error" | "charge_error" | "payment_timeout" | Transaction.Aborted, "release_error">
	>();
	expectTypeOf<Outputs["reservation"]>().toEqualTypeOf<{ id: string; total: number; }>();
	expectTypeOf<Outputs["payment"]>().toEqualTypeOf<{ id: string; }>();
	expectTypeOf(result).toMatchTypeOf<
		Deferred<
			Result<
				Transaction.Failure<"inventory_error" | "charge_error" | "payment_timeout" | Transaction.Aborted, "release_error">,
				{ readonly reservation: Reservation; readonly payment: Payment; }
			>
		>
	>();

	// @ts-expect-error — a run must supply the input required by its steps
	Transaction.run(tx);
	// @ts-expect-error — the transaction input must satisfy the order contract
	Transaction.run(tx, { input: { sku: "book" } });
	// @ts-expect-error — a dependency must occur before the dependent step
	Transaction.make(payment, reservation);
	// @ts-expect-error — a dependency must be included in the transaction
	Transaction.make(payment);
	// @ts-expect-error — step IDs must be unique
	Transaction.make(reservation, reservation);

	const unrelated = Transaction.step({ id: "unrelated", run: () => () => Task.Result.make.ok("unused") });
	const dependent = Transaction.step({
		id: "dependent",
		deps: { reservation, unrelated },
		run: () => () => Task.Result.make.ok(undefined),
	});
	// @ts-expect-error — each dependency must appear in the transaction
	Transaction.make(reservation, dependent);
});

test("make: no-input and dynamic step lists preserve input requirements", () => {
	const upload = Transaction.step({ id: "upload", run: () => () => Task.Result.make.ok("file") });
	const index = Transaction.step({
		id: "index",
		deps: { file: upload },
		run: ({ file }) => () => Task.Result.make.ok(file.length),
	});
	const noInput = Transaction.make(upload, index);
	expectTypeOf(Transaction.run(noInput)).toEqualTypeOf<
		Deferred<
			Result<Transaction.Failure<Transaction.Aborted, never>, { readonly upload: string; readonly index: number; }>
		>
	>();
	// @ts-expect-error — no-input transactions do not accept an input
	Transaction.run(noInput, { input: "unexpected" });

	const lookup = Transaction.step({ id: "lookup", run: () => (order: Order) => Task.Result.make.ok(order.sku) });
	const steps = [upload, lookup];
	const dynamic = Transaction.make(...steps);
	Transaction.run(dynamic, { input: { sku: "book", quantity: 1 } });
	// @ts-expect-error — dynamic collections retain required input types
	Transaction.run(dynamic);

	const explicitlyTyped: Transaction.AnyStep<Order>[] = [upload, lookup];
	const typedDynamic = Transaction.make(...explicitlyTyped);
	Transaction.run(typedDynamic, { input: { sku: "book", quantity: 1 } });
	// @ts-expect-error — an explicitly typed dynamic collection retains its input requirement
	Transaction.run(typedDynamic);
});

test("run: domain input shaped like options is passed unchanged", () => {
	type SignalInput = { readonly signal: AbortSignal; };
	const inspect = Transaction.step({
		id: "inspect",
		run: () => (input: SignalInput) => {
			expectTypeOf(input.signal).toEqualTypeOf<AbortSignal>();
			return Task.Result.make.ok(input.signal.aborted);
		},
	});
	const tx = Transaction.make(inspect);
	const controller = new AbortController();
	expectTypeOf(Transaction.run(tx, { input: { signal: controller.signal } })).toEqualTypeOf<
		Deferred<Result<Transaction.Failure<Transaction.Aborted, never>, { readonly inspect: boolean; }>>
	>();
});

test("make: combines independent input requirements without losing either", () => {
	const inventoryStep = Transaction.step({
		id: "inventory",
		run: () => (input: { readonly sku: string; }) => Task.Result.make.ok(input.sku),
	});
	const payment = Transaction.step({
		id: "payment",
		deps: { inventory: inventoryStep },
		run: ({ inventory }) => (input: { readonly customerId: string; }) =>
			Task.Result.make.ok(`${inventory}:${input.customerId}`),
	});
	const tx = Transaction.make(inventoryStep, payment);
	expectTypeOf(Transaction.run(tx, { input: { sku: "book", customerId: "mina" } })).toBeObject();
	// @ts-expect-error — the payment step also requires a customer ID
	Transaction.run(tx, { input: { sku: "book" } });
});

test("make: accepts a dependency exposed through the supported broad step type", () => {
	const reserve = Transaction.step({ id: "reserve", run: () => (order: Order) => Task.Result.make.ok(order.sku) });
	const build = (dependency: Transaction.AnyStep<Order>) => {
		const dependent = Transaction.step({
			id: "dependent",
			deps: { dependency },
			run: ({ dependency: previous }) => (order: Order) => Task.Result.make.ok({ dependency: previous, sku: order.sku }),
		});
		return Transaction.make(reserve, dependent);
	};
	const tx = build(reserve);
	expectTypeOf(Transaction.run(tx, { input: { sku: "book", quantity: 1 } })).toBeObject();
	// @ts-expect-error — broad dependencies do not remove the transaction input requirement
	Transaction.run(tx);
});

test("make: allows a dependency whose union type can refer to an earlier step", () => {
	const first = Transaction.step({ id: "first", run: () => () => Task.Result.make.ok("one") });
	const other = Transaction.step({ id: "other", run: () => () => Task.Result.make.ok("two") });
	const dependency = constTruthyBool() ? first : other;
	const dependent = Transaction.step({
		id: "dependent",
		deps: { dependency },
		run: ({ dependency: value }) => () => Task.Result.make.ok(value.toUpperCase()),
	});
	const transaction = Transaction.make(first, dependent);
	expectTypeOf(Transaction.run(transaction)).toBeObject();
});

test("make: supports conditional dependency records and accurately types absent entries", () => {
	const first = Transaction.step({ id: "first", run: () => () => Task.Result.make.ok("one") });
	const other = Transaction.step({ id: "other", run: () => () => Task.Result.make.ok("two") });
	const deps = constTruthyBool() ? { primary: first } : { alternate: other };
	const dependent = Transaction.step({
		id: "dependent",
		deps,
		run: (resolved) => () => {
			expectTypeOf(resolved.primary).toEqualTypeOf<string | undefined>();
			expectTypeOf(resolved.alternate).toEqualTypeOf<string | undefined>();
			return Task.Result.make.ok(resolved.primary ?? resolved.alternate);
		},
	});
	expectTypeOf(Transaction.make(first, dependent)).toBeObject();
	const missingVariant = Transaction.step({
		id: "missingVariant",
		deps: constTruthyBool() ? { firstMissing: other } : { secondMissing: other },
		run: () => () => Task.Result.make.ok(undefined),
	});
	// @ts-expect-error — neither dependency variant can refer to the supplied earlier step
	Transaction.make(first, missingVariant);

	const optional = Transaction.step({
		id: "optional",
		deps: { skipped: undefined },
		run: (resolved) => () => {
			expectTypeOf(resolved.skipped).toEqualTypeOf<undefined>();
			return Task.Result.make.ok(undefined);
		},
	});
	expectTypeOf(Transaction.make(optional)).toBeObject();
});

test("step: rejects reserved identifiers", () => {
	const invalid = Transaction.step({
		// @ts-expect-error — the reserved identifier is not available for a step
		id: "initial",
		run: () => () => Task.Result.make.ok(1),
	});
	expectTypeOf(invalid).toBeObject();
});
