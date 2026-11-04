import type { WithKind } from "../internal/InternalTypes.ts";
import { Aborted } from "./Aborted.ts";
import { Deferred } from "./Deferred.ts";
import { Result } from "./Result.ts";
import { Task } from "./Task.ts";

// =============================================================================
// Phantom Brand & Internal Symbols
// =============================================================================

declare const _transactionBrand: unique symbol;
declare const _stepBrand: unique symbol;
const _internalTransaction = Symbol("Transaction.internalTransaction");
const _internalStep = Symbol("Transaction.internalStep");

// =============================================================================
// Types & Constructors
// =============================================================================
// Public Types
// =============================================================================

/**
 * A reusable sequence of asynchronous steps with optional actions to undo completed work.
 *
 * If a step returns an error, completed steps that have an `undo` action are undone in reverse
 * order. Undo actions can also fail; their errors are returned alongside the original error.
 *
 * @template In - The initial input payload supplied to the transaction on execution.
 * @template Acc - The accumulated dictionary of step outputs available to downstream steps.
 * @template E - The union of forward execution error types across all registered steps.
 * @template EUndo - The union of error types that can occur during compensating `undo` actions.
 *
 * @example
 * ```ts
 * const step = Transaction.stepFactory<OrderInput>();
 * const reservation = step(
 *   "reservation",
 *   ({ ctx }) => inventoryApi.reserve(ctx.input.sku, ctx.input.qty),
 *   ({ ctx }) => inventoryApi.release(ctx.output.id),
 * );
 * const payment = step(
 *   "payment",
 *   { reservation },
 *   ({ ctx, deps }) => stripeApi.charge(ctx.input.customerId, deps.reservation.totalCents),
 *   ({ ctx }) => stripeApi.refund(ctx.output.chargeId),
 * );
 * const checkout = Transaction.make(reservation, payment);
 *
 * const outcome = await Transaction.run(orderInput)(checkout);
 * ```
 */
export type Transaction<
	In = void,
	Acc extends Record<string, unknown> = Record<never, never>,
	E = never,
	EUndo = never,
> = WithKind<"Transaction"> & {
	readonly [_transactionBrand]: {
		readonly _in: (_in: In) => void;
		readonly _acc: () => Acc;
		readonly _error: () => E;
		readonly _undoError: () => EUndo;
	};
};

export namespace Transaction {
	/**
	 * Telemetry and failure metadata when an individual step's compensating `undo` action fails.
	 */
	export type UndoFailure<EUndo = unknown> = {
		/**
		 * The unique identifier of the step whose `undo` action failed.
		 */
		readonly stepId: string;

		/**
		 * The error emitted by the step's `undo` action.
		 */
		readonly error: EUndo;
	};

	/**
	 * Discriminated failure outcome returned when a Transaction halts execution.
	 *
	 * Identifies the forward step that triggered the rollback, its root error,
	 * and an attributed list of any errors encountered while running compensating `undo` actions.
	 */
	export type Failure<E, EUndo = never> = WithKind<"TransactionFailure"> & {
		/**
		 * The unique identifier of the forward step that failed or was interrupted.
		 */
		readonly stepId: string;

		/**
		 * The root error that caused the transaction to fail.
		 */
		readonly error: E;

		/**
		 * Attributed record of any errors encountered during reverse LIFO rollback.
		 * Empty if all completed steps were compensated successfully.
		 */
		readonly undoErrors: readonly UndoFailure<EUndo>[];
	};

	/** A reusable step definition. The input is supplied separately for each transaction run. */
	export type Step<Id extends string, Input, E, Out, EUndo, Deps> = WithKind<"TransactionStep"> & {
		readonly id: Id;
		readonly [_stepBrand]: {
			readonly input: (input: Input) => void;
			readonly error: () => E;
			readonly output: () => Out;
			readonly undo: () => EUndo;
			readonly deps: () => Deps;
		};
	};

	/** A step that either needs the given input or does not use input. */
	export type AnyStep<Input> =
		| Step<string, Input, unknown, unknown, unknown, unknown>
		| Step<string, void, unknown, unknown, unknown, unknown>;

	/** The output value produced by a step. */
	export type OutputOf<S> = S extends Step<string, never, unknown, infer Out, unknown, unknown> ? Out : never;

	/** The output values of the named dependencies supplied to a step. */
	export type DependencyOutputs<D extends Record<string, AnyStepInternal | undefined>> = {
		readonly [K in keyof D]: undefined extends D[K] ? OutputOf<Exclude<D[K], undefined>> | undefined : OutputOf<D[K]>;
	};

	/** Creates the task for a step using the run input and dependency outputs. */
	export type StepRun<D extends Record<string, AnyStepInternal | undefined>, Input, E, Out> = (
		context: { readonly ctx: { readonly input: Input; }; readonly deps: DependencyOutputs<D>; },
	) => Task.Result<E, Out>;

	/** Compensates a completed step if a later step fails. */
	export type StepUndo<D extends Record<string, AnyStepInternal | undefined>, Input, Out, EUndo> = (
		context: { readonly ctx: { readonly input: Input; readonly output: Out; }; readonly deps: DependencyOutputs<D>; },
	) => Task.Result<EUndo, unknown>;

	/** Creates independently reusable steps sharing an input contract. */
	export type StepFactory<Input> = {
		<const Id extends string, E = never, Out = never, EUndo = never>(
			id: Id extends "initial" ? never : Id,
			run: StepRun<Record<never, never>, Input, E, Out>,
			undo?: StepUndo<Record<never, never>, Input, Out, EUndo>,
		): Step<Id, Input, E, Out, EUndo, Record<never, never>>;
		<
			const Id extends string,
			const D extends Record<string, AnyStepInternal | undefined> = Record<never, never>,
			E = never,
			Out = never,
			EUndo = never,
		>(
			id: Id extends "initial" ? never : Id,
			deps: D,
			run: StepRun<D, Input, E, Out>,
			undo?: StepUndo<D, Input, Out, EUndo>,
		): Step<Id, Input, E, Out, EUndo, D>;
	};

	/**
	 * Execution options and telemetry hooks for `Transaction.run`.
	 */
	export type RunOptions<E = unknown, EUndo = unknown> = {
		/**
		 * AbortSignal passed to forward tasks. Completed steps are rolled back after a failure
		 * or when cancellation is observed before the next step.
		 */
		readonly signal?: AbortSignal;

		/**
		 * Telemetry callback fired whenever a forward step succeeds.
		 */
		readonly onStepSuccess?: (metadata: { readonly stepId: string; readonly output: unknown; }) => void;

		/**
		 * Telemetry callback fired whenever a forward step fails (before rollback begins).
		 */
		readonly onStepFailure?: (metadata: { readonly stepId: string; readonly error: E; }) => void;

		/**
		 * Telemetry callback fired whenever an individual step's `undo` action completes.
		 */
		readonly onUndo?: (metadata: { readonly stepId: string; readonly error?: EUndo; }) => void;
	};
}

// =============================================================================
// Internal Representation
// =============================================================================

type InternalStep = {
	readonly id: string;
	readonly deps: Readonly<Record<string, AnyStepInternal | undefined>>;
	readonly run: (context: { readonly ctx: { readonly input: any; }; readonly deps: any; }) => Task.Result<any, any>;
	readonly undo?: (
		context: { readonly ctx: { readonly input: any; readonly output: any; }; readonly deps: any; },
	) => Task.Result<any, any>;
};

type AnyStepInternal = Transaction.Step<string, never, unknown, unknown, unknown, unknown>;
type InputOf<S> = S extends Transaction.Step<string, infer Input, unknown, unknown, unknown, unknown> ? Input : never;
type ErrorOf<S> = S extends Transaction.Step<string, never, infer E, unknown, unknown, unknown> ? E : never;
type UndoErrorOf<S> = S extends Transaction.Step<string, never, unknown, unknown, infer E, unknown> ? E : never;
type DependenciesOf<S> = S extends Transaction.Step<string, never, unknown, unknown, unknown, infer D> ? D : never;
type InputFunction<S> = S extends AnyStepInternal ? (input: [InputOf<S>] extends [void] ? unknown : InputOf<S>) => void
	: never;
type CombinedInput<S extends readonly AnyStepInternal[]> = [S[number]] extends [never] ? void
	: InputFunction<S[number]> extends (input: infer Input) => void ? unknown extends Input ? void : Input
	: void;
type StepOutputs<S extends readonly AnyStepInternal[]> = {
	readonly [Step in S[number] as Step["id"]]: Transaction.OutputOf<Step>;
};
type KnownDuplicate<Id extends string, Ids extends string> = string extends Id ? false
	: string extends Ids ? false : Id extends Ids ? true
	: false;
type MissingDependencies<D, Ids extends string> = D extends Record<string, AnyStepInternal | undefined>
	? {
		[K in keyof D]-?: undefined extends D[K] ? never
			: string extends NonNullable<D[K]>["id"] ? never : string extends Ids ? never
			: [Extract<NonNullable<D[K]>["id"], Ids>] extends [never] ? K
			: never;
	}[keyof D]
	: never;
type InvalidDependencyVariant<D, Ids extends string> = D extends unknown
	? [MissingDependencies<D, Ids>] extends [never] ? false : true
	: never;
type ValidSequence<S extends readonly AnyStepInternal[], Ids extends string = never> = S extends
	readonly [infer Head extends AnyStepInternal, ...infer Tail extends readonly AnyStepInternal[]]
	? Head["id"] extends "initial" ? false
	: KnownDuplicate<Head["id"], Ids> extends true ? false
	: false extends InvalidDependencyVariant<DependenciesOf<Head>, Ids> ? ValidSequence<Tail, Ids | Head["id"]>
	: false
	: true;

type InternalStepValue = AnyStepInternal & { readonly [_internalStep]: InternalStep; };
const toInternalStep = (step: AnyStepInternal): InternalStepValue => step as InternalStepValue;

type InternalTransactionState = { readonly steps: readonly InternalStep[]; };

type InternalTransaction<In, Acc extends Record<string, unknown>, E, EUndo> = Transaction<In, Acc, E, EUndo> & {
	readonly [_internalTransaction]: InternalTransactionState;
};

const toInternal = <In, Acc extends Record<string, unknown>, E, EUndo>(
	tx: Transaction<In, Acc, E, EUndo>,
): InternalTransaction<In, Acc, E, EUndo> => tx as unknown as InternalTransaction<In, Acc, E, EUndo>;

// =============================================================================
// Helper: Undo Stack Drain
// =============================================================================

type UndoItem = {
	readonly id: string;
	readonly undo: (
		context: { readonly ctx: { readonly input: any; readonly output: unknown; }; readonly deps: any; },
	) => Task.Result<unknown, unknown>;
	readonly output: unknown;
	readonly dependencies: Readonly<Record<string, unknown>>;
};

const drainUndoStack = async (
	undoStack: readonly UndoItem[],
	options: Transaction.RunOptions | undefined,
	input: unknown,
): Promise<readonly Transaction.UndoFailure[]> => {
	const undoErrors: Transaction.UndoFailure[] = [];

	for (let j = undoStack.length - 1; j >= 0; j--) {
		const item = undoStack[j];
		const undoTask = item.undo({ ctx: { input, output: item.output }, deps: item.dependencies });
		const undoOutcome = await Deferred.to.Promise(undoTask(undefined));
		if (Result.is.err(undoOutcome)) {
			const errRecord = { stepId: item.id, error: undoOutcome.error };
			undoErrors.push(errRecord);
			options?.onUndo?.(errRecord);
		} else {
			options?.onUndo?.({ stepId: item.id });
		}
	}

	return Object.freeze(undoErrors);
};

// =============================================================================
// Public Constructors & Combinators
// =============================================================================

/** Creates a reusable step with optional dependencies and optional compensation. */
function step<const Id extends string, Input = void, E = never, Out = never, EUndo = never>(
	id: Id extends "initial" ? never : Id,
	run: Transaction.StepRun<Record<never, never>, Input, E, Out>,
	undo?: Transaction.StepUndo<Record<never, never>, Input, Out, EUndo>,
): Transaction.Step<Id, Input, E, Out, EUndo, Record<never, never>>;
function step<
	const Id extends string,
	const D extends Record<string, AnyStepInternal | undefined> = Record<never, never>,
	Input = void,
	E = never,
	Out = never,
	EUndo = never,
>(
	id: Id extends "initial" ? never : Id,
	deps: D,
	run: Transaction.StepRun<D, Input, E, Out>,
	undo?: Transaction.StepUndo<D, Input, Out, EUndo>,
): Transaction.Step<Id, Input, E, Out, EUndo, D>;
function step(
	id: string,
	arg2: Record<string, AnyStepInternal | undefined> | Transaction.StepRun<any, any, any, any>,
	arg3?: Transaction.StepRun<any, any, any, any> | Transaction.StepUndo<any, any, any, any>,
	arg4?: Transaction.StepUndo<any, any, any, any>,
) {
	if (id.length === 0) {
		throw new TypeError("[Transaction.step] A non-empty string 'id' is required.");
	}
	if (id === "initial") {
		throw new TypeError("[Transaction.step] Step id cannot be 'initial' as it is a reserved context key.");
	}

	const hasDeps = typeof arg2 !== "function";
	const deps = hasDeps ? arg2 as Record<string, AnyStepInternal | undefined> : undefined;
	const run = (hasDeps ? arg3 : arg2) as Transaction.StepRun<any, any, any, any> | undefined;
	const undo = (hasDeps ? arg4 : arg3) as Transaction.StepUndo<any, any, any, any> | undefined;

	if (typeof run !== "function") {
		throw new TypeError("[Transaction.step] A run callback is required.");
	}

	const value = {
		kind: "TransactionStep" as const,
		id,
		[_internalStep]: { id, deps: Object.freeze({ ...deps }), run, undo },
	};
	return value as unknown as Transaction.Step<string, any, any, any, any, any>;
}

/** Assembles steps in execution order and validates their dependencies. */
const makeTransaction = <const S extends readonly AnyStepInternal[]>(
	...steps: S & (ValidSequence<S> extends true ? unknown : never)
): Transaction<CombinedInput<S>, StepOutputs<S>, ErrorOf<S[number]>, UndoErrorOf<S[number]>> => {
	const seen = new Set<AnyStepInternal>();
	const ids = new Set<string>();
	const compiled: InternalStep[] = [];
	for (const value of steps) {
		const current = toInternalStep(value)[_internalStep];
		if (ids.has(current.id)) {
			throw new Error(`[Transaction.make] Duplicate step id '${current.id}'. Every step must have a unique id.`);
		}
		for (const dependency of Object.values(current.deps)) {
			if (dependency !== undefined && !seen.has(dependency)) {
				throw new Error(`[Transaction.make] Dependency '${dependency.id}' must precede step '${current.id}'.`);
			}
		}
		ids.add(current.id);
		seen.add(value);
		compiled.push(current);
	}
	const tx = { kind: "Transaction" as const, [_internalTransaction]: { steps: Object.freeze(compiled) } };
	return tx as unknown as Transaction<CombinedInput<S>, StepOutputs<S>, ErrorOf<S[number]>, UndoErrorOf<S[number]>>;
};

/**
 * Starts a Transaction and returns a deferred result.
 *
 * Steps run sequentially. If all steps succeed, returns `Ok(Acc)` containing all step outputs.
 * If a step returns an error or cancellation is observed before a step starts, completed steps
 * with undo actions are undone in reverse order and the result is `Err(Transaction.Failure)`.
 * Active tasks receive the signal and must handle cancellation themselves.
 *
 * @see {@link Transaction.step} for configuring transactional steps with compensating undo actions.
 *
 * A transaction with no input is run as `Transaction.run()(transaction)`. Pass `undefined` as the
 * input when such a transaction also needs run options:
 * `Transaction.run(undefined, { signal })(transaction)`.
 *
 * @example
 * ```ts
 * const outcome = await Transaction.run(orderInput)(checkoutTransaction);
 * ```
 */
function runTransaction(): <Acc extends Record<string, unknown>, E, EUndo>(
	transaction: Transaction<void, Acc, E, EUndo>,
) => Deferred<Result<Transaction.Failure<E | Aborted, EUndo>, Acc>>;

function runTransaction<In>(
	input: In,
	options?: Transaction.RunOptions,
): <Acc extends Record<string, unknown>, E, EUndo>(
	transaction: Transaction<In, Acc, E, EUndo>,
) => Deferred<Result<Transaction.Failure<E | Aborted, EUndo>, Acc>>;

function runTransaction<In>(input?: In, options?: Transaction.RunOptions) {
	return <Acc extends Record<string, unknown>, E, EUndo>(
		transaction: Transaction<In, Acc, E, EUndo>,
	): Deferred<Result<Transaction.Failure<E | Aborted, EUndo>, Acc>> =>
		Deferred.from.Promise((async () => {
			const internal = toInternal(transaction)[_internalTransaction];

			const activeSignal = options?.signal;

			if (activeSignal?.aborted) {
				return Result.make.err({
					kind: "TransactionFailure" as const,
					stepId: internal.steps[0]?.id ?? "initial",
					error: Aborted.make(activeSignal.reason),
					undoErrors: [],
				});
			}

			const acc: Record<string, unknown> = {};
			const undoStack: UndoItem[] = [];

			for (let i = 0; i < internal.steps.length; i++) {
				const stepDef = internal.steps[i];

				if (activeSignal?.aborted) {
					const undoErrors = await drainUndoStack(undoStack, options, input);
					return Result.make.err({
						kind: "TransactionFailure" as const,
						stepId: stepDef.id,
						error: Aborted.make(activeSignal.reason),
						undoErrors: undoErrors as readonly Transaction.UndoFailure<EUndo>[],
					});
				}

				const dependencies: Record<string, unknown> = {};
				for (const [name, dependency] of Object.entries(stepDef.deps)) {
					if (dependency !== undefined) {
						dependencies[name] = acc[dependency.id];
					}
				}
				const stepTask: Task.Result<unknown, unknown> = (signal) =>
					stepDef.run({ ctx: { input }, deps: dependencies })(signal);
				const stepOutcome = await Deferred.to.Promise(stepTask(activeSignal));
				if (Result.is.err(stepOutcome)) {
					const { error } = stepOutcome;
					options?.onStepFailure?.({ stepId: stepDef.id, error });

					const undoErrors = await drainUndoStack(undoStack, options, input);
					return Result.make.err({
						kind: "TransactionFailure" as const,
						stepId: stepDef.id,
						error: error as E,
						undoErrors: undoErrors as readonly Transaction.UndoFailure<EUndo>[],
					});
				}

				const out = stepOutcome.value;
				options?.onStepSuccess?.({ stepId: stepDef.id, output: out });

				acc[stepDef.id] = out;
				if (stepDef.undo) {
					undoStack.push({
						id: stepDef.id,
						undo: stepDef.undo,
						output: out,
						dependencies: Object.freeze({ ...dependencies }),
					});
				}
			}

			return Result.make.ok(acc as Acc);
		})());
}

// =============================================================================
// Module Export
// =============================================================================

export const Transaction = {
	/**
	 * Creates a step constructor with a shared input type.
	 *
	 * @example
	 * ```ts
	 * const step = Transaction.stepFactory<Order>();
	 * const reserve = step("reserve", ({ ctx }) => reserveStock(ctx.input.sku));
	 * ```
	 */
	stepFactory: <Input>(): Transaction.StepFactory<Input> => step,
	/**
	 * Assembles step definitions in execution order and validates their dependencies.
	 *
	 * @see {@link Transaction.step} for defining reusable steps.
	 *
	 * @example
	 * ```ts
	 * const checkout = Transaction.make(reservation, payment);
	 * ```
	 */
	make: makeTransaction,

	/**
	 * Defines a reusable step with optional named dependencies and compensation.
	 *
	 * The step receives its run input in `ctx` and declared dependency outputs in `deps`.
	 * An optional `undo` action can reverse external mutations if a later step fails.
	 *
	 * @see {@link Transaction.run} for executing the compiled transaction.
	 *
	 * @example
	 * ```ts
	 * const step = Transaction.stepFactory<OrderInput>();
	 * const reserve = step(
	 *   "inventory",
	 *   ({ ctx }) => reserveInventory(ctx.input.sku),
	 *   ({ ctx }) => releaseInventory(ctx.output.id),
	 * );
	 * ```
	 */
	step,

	/**
	 * Starts a `Transaction` and returns a deferred result.
	 *
	 * Steps run sequentially. If all steps succeed, returns `Ok(Acc)` containing all step outputs.
	 * If a step returns an error or cancellation is observed before a step starts, completed steps
	 * with undo actions are undone in reverse order and the result is `Err(Transaction.Failure)`.
	 * Active tasks receive the signal and must handle cancellation themselves.
	 *
	 * @see {@link Transaction.step} for configuring transactional steps with compensating undo actions.
	 *
	 * @example
	 * ```ts
	 * const outcome = await Transaction.run(orderInput, { signal })(checkout);
	 * ```
	 */
	run: runTransaction,
};
