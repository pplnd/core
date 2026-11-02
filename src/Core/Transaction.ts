import type { WithKind } from "../internal/InternalTypes.ts";
import type { Duration } from "../Types/Duration.ts";
import type { RetryPolicy } from "../Types/RetryPolicy.ts";
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
// Prototype Pollution Shield
// =============================================================================

const setProperty = <T extends Record<string, unknown>>(target: T, key: string, value: unknown): void => {
	if (key === "__proto__") {
		Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
	} else {
		(target as Record<string, unknown>)[key] = value;
	}
};

// =============================================================================
// Public Types
// =============================================================================

/**
 * An immutable, transactional workflow descriptor coordinating a linear sequence of
 * asynchronous steps with automatic reverse (LIFO) rollback upon failure.
 *
 * Each step receives its declared dependencies and can optionally register an `undo` action.
 * If any step fails or times out, all previously
 * completed steps are undone in strict reverse order to maintain consistency across external services.
 *
 * @template In - The initial input payload supplied to the transaction on execution.
 * @template Acc - The accumulated dictionary of step outputs available to downstream steps.
 * @template E - The union of forward execution error types across all registered steps.
 * @template EUndo - The union of error types that can occur during compensating `undo` actions.
 *
 * @example
 * ```ts
 * const reservation = Transaction.step({
 *   id: "reservation",
 *   run: () => (order: OrderInput) => inventoryApi.reserve(order.sku, order.qty),
 *   undo: (res) => inventoryApi.release(res.id),
 * });
 * const payment = Transaction.step({
 *   id: "payment",
 *   deps: { reservation },
 *   run: ({ reservation }) => (order: OrderInput) => stripeApi.charge(order.customerId, reservation.totalCents),
 *   undo: (pay) => stripeApi.refund(pay.chargeId),
 * });
 * const checkout = Transaction.make(reservation, payment);
 *
 * const outcome = await Transaction.run(checkout, { input: orderInput });
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
	/** Cancellation observed before starting a step. */
	export type Aborted = { readonly kind: "TransactionAborted"; readonly reason: unknown; };

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

	/** Settings for a step, including its named dependencies and optional compensation. */
	export type StepConfig<
		Id extends string,
		D extends Record<string, AnyStepInternal | undefined>,
		Input,
		E,
		Out,
		EUndo = never,
		ETimeout = never,
	> = {
		/** Unique identifier for this step within the transaction. */
		readonly id: Id extends "initial" ? never : Id;
		/** Earlier steps whose output values are needed by this step. */
		readonly deps?: D;
		/** Creates the task to run with these dependency outputs and execution input. */
		readonly run: (dependencies: DependencyOutputs<D>) => (input: Input) => Task.Result<E, Out>;
		/** Compensates a completed step if a later step fails. */
		readonly undo?: (output: Out, dependencies: DependencyOutputs<D>, input: Input) => Task.Result<EUndo, unknown>;
		/** Retry policy for the forward task. */
		readonly retry?: RetryPolicy<any>;
		/** Deadline and error for the forward task. */
		readonly timeout?: { readonly duration: Duration; readonly onTimeout: () => ETimeout; };
	};

	/**
	 * Execution options and telemetry hooks for `Transaction.run`.
	 */
	export type RunOptions<E = unknown, EUndo = unknown> = {
		/**
		 * AbortSignal to cancel the transaction. If aborted, in-flight forward execution is halted
		 * and all completed steps are immediately rolled back in LIFO order.
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
	readonly run: (dependencies: any) => (input: any) => Task.Result<any, any>;
	readonly undo?: (output: any, dependencies: any, input: any) => Task.Result<any, any>;
	readonly retry?: RetryPolicy<any>;
	readonly timeout?: { readonly duration: Duration; readonly onTimeout: () => any; };
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
	readonly undo: (output: unknown, dependencies: any, input: any) => Task.Result<unknown, unknown>;
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
		const undoTask = item.undo(item.output, item.dependencies, input);
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

/** Creates a reusable step with named dependencies and optional compensation. */
const step = <
	const Id extends string,
	const D extends Record<string, AnyStepInternal | undefined> = Record<never, never>,
	Input = void,
	E = never,
	Out = never,
	EUndo = never,
	ETimeout = never,
>(
	config: Transaction.StepConfig<Id, D, Input, E, Out, EUndo, ETimeout>,
): Transaction.Step<Id, Input, E | ETimeout, Out, EUndo, D> => {
	if (config.id.length === 0) {
		throw new TypeError("[Transaction.step] A non-empty string 'id' is required.");
	}
	if (config.id === "initial") {
		throw new TypeError("[Transaction.step] Step id cannot be 'initial' as it is a reserved context key.");
	}
	const value = {
		kind: "TransactionStep" as const,
		id: config.id,
		[_internalStep]: {
			id: config.id,
			deps: Object.freeze({ ...config.deps }),
			run: config.run,
			undo: config.undo,
			retry: config.retry,
			timeout: config.timeout,
		},
	};
	return value as unknown as Transaction.Step<Id, Input, E | ETimeout, Out, EUndo, D>;
};

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
 * If any step returns an error or is aborted, completed steps are undone in reverse (LIFO) order
 * and returns `Err(Transaction.Failure)`.
 *
 * @see {@link Transaction.step} for configuring transactional steps with compensating undo actions.
 *
 * @example
 * ```ts
 * const outcome = await Transaction.run(checkoutTransaction, { input: orderInput, signal });
 * ```
 */
/**
 * Executes a zero-input Transaction with optional run options.
 */
function runTransaction<Acc extends Record<string, unknown>, E, EUndo>(
	transaction: Transaction<void, Acc, E, EUndo>,
	options?: Transaction.RunOptions & { readonly input?: never; },
): Deferred<Result<Transaction.Failure<E | Transaction.Aborted, EUndo>, Acc>>;

/**
 * Executes a parameterized Transaction with input and optional run options.
 */
function runTransaction<In, Acc extends Record<string, unknown>, E, EUndo>(
	transaction: Transaction<In, Acc, E, EUndo>,
	options: Transaction.RunOptions & { readonly input: NoInfer<In>; },
): Deferred<Result<Transaction.Failure<E | Transaction.Aborted, EUndo>, Acc>>;

function runTransaction<In, Acc extends Record<string, unknown>, E, EUndo>(
	transaction: Transaction<In, Acc, E, EUndo>,
	options?: Transaction.RunOptions & { readonly input?: In; },
): Deferred<Result<Transaction.Failure<E | Transaction.Aborted, EUndo>, Acc>> {
	return Deferred.from.Promise((async () => {
		const input = options?.input;
		const internal = toInternal(transaction)[_internalTransaction];

		const activeSignal = options?.signal;

		if (activeSignal?.aborted) {
			return Result.make.err({
				kind: "TransactionFailure" as const,
				stepId: internal.steps[0]?.id ?? "initial",
				error: { kind: "TransactionAborted" as const, reason: activeSignal.reason },
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
					error: { kind: "TransactionAborted" as const, reason: activeSignal.reason },
					undoErrors: undoErrors as readonly Transaction.UndoFailure<EUndo>[],
				});
			}

			const dependencies: Record<string, unknown> = {};
			for (const [name, dependency] of Object.entries(stepDef.deps)) {
				if (dependency !== undefined) {
					setProperty(dependencies, name, acc[dependency.id]);
				}
			}
			const stepTask: Task.Result<unknown, unknown> = (signal) => stepDef.run(dependencies)(input)(signal);
			let effectiveTask = stepTask;
			if (stepDef.retry) {
				effectiveTask = Task.Result.retry(stepDef.retry)(effectiveTask);
			}
			if (stepDef.timeout) {
				effectiveTask = Task.Result.timeout(stepDef.timeout)(effectiveTask);
			}

			const stepOutcome = await Deferred.to.Promise(effectiveTask(activeSignal));
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

			setProperty(acc, stepDef.id, out);
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
	 * The step receives the outputs of declared dependencies, then the input for each run.
	 * An optional `undo` action can reverse external mutations if a later step fails.
	 *
	 * @see {@link Transaction.run} for executing the compiled transaction.
	 *
	 * @example
	 * ```ts
	 * const reserve = Transaction.step({
	 *   id: "inventory",
	 *   run: () => (order: OrderInput) => reserveInventory(order.sku),
	 *   undo: (res) => releaseInventory(res.id),
	 * });
	 * ```
	 */
	step,

	/**
	 * Starts a `Transaction` and returns a deferred result.
	 *
	 * Steps run sequentially. If all steps succeed, returns `Ok(Acc)` containing all step outputs.
	 * If any step fails, times out, or is aborted, completed steps are undone in reverse (LIFO) order
	 * and returns `Err(Transaction.Failure)`.
	 *
	 * @see {@link Transaction.step} for configuring transactional steps with compensating undo actions.
	 *
	 * @example
	 * ```ts
	 * const outcome = await Transaction.run(checkout, { input: orderInput, signal });
	 * ```
	 */
	run: runTransaction,
};
