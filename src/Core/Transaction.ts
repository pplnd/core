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
const _internalTransaction = Symbol("Transaction.internalTransaction");

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
 * Each step receives the accumulated outputs of all preceding successful steps, and can
 * optionally register an `undo` action. If any step fails or times out, all previously
 * completed steps are undone in strict reverse order to maintain consistency across external services.
 *
 * @template In - The initial input payload supplied to the transaction on execution.
 * @template Acc - The accumulated dictionary of step outputs available to downstream steps.
 * @template E - The union of forward execution error types across all registered steps.
 * @template EUndo - The union of error types that can occur during compensating `undo` actions.
 *
 * @example
 * ```ts
 * const checkout = pipe(
 *   Transaction.make<OrderInput>(),
 *   Transaction.step({
 *     id: "reservation",
 *     run: ({ initial }) => inventoryApi.reserve(initial.sku, initial.qty),
 *     undo: (res) => inventoryApi.release(res.id),
 *   }),
 *   Transaction.step({
 *     id: "payment",
 *     run: ({ initial, reservation }) => stripeApi.charge(initial.customerId, reservation.totalCents),
 *     undo: (pay) => stripeApi.refund(pay.chargeId),
 *   }),
 *   Transaction.step({
 *     id: "shipment",
 *     run: ({ initial, reservation, payment }) => shippingApi.dispatch(initial.address, reservation.id, payment.chargeId),
 *   }),
 * );
 *
 * const outcome = await pipe(checkout, Transaction.run(orderInput))();
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

	/**
	 * Contextual dictionary received by forward `run` and rollback `undo` step handlers.
	 *
	 * If the transaction defines an initial input `In`, it is accessible under `context.initial`.
	 * All previously completed step outputs are accessible under their declared step `id` keys.
	 */
	export type StepContext<In, Acc> = [In] extends [void] ? Acc : { readonly initial: In; } & Acc;

	/**
	 * Configuration options for an individual step within a Transaction.
	 */
	export type StepConfig<
		In,
		Acc extends Record<string, unknown>,
		Id extends string,
		Out,
		E,
		EUndo = never,
		ETimeout = never,
	> = {
		/**
		 * Unique string identifier for the step within the transaction.
		 * Cannot duplicate an existing step ID or use the reserved key "initial".
		 */
		readonly id: 0 extends 1 & Id ? Id
			: string extends keyof Acc ? ([Id] extends ["initial"] ? never : Id)
			: ([Id] extends [keyof Acc | "initial"] ? never : Id);

		/**
		 * Forward asynchronous operation evaluating to a fallible `Task.Result`.
		 */
		readonly run: (context: StepContext<In, Acc>) => Task.Result<E, Out>;

		/**
		 * Optional compensating rollback action executed in LIFO reverse order
		 * if this or any subsequent step fails.
		 */
		readonly undo?: (output: Out, context: StepContext<In, Acc>) => Task.Result<EUndo, unknown>;

		/**
		 * Optional retry policy applied to the forward `run` action before failing the step.
		 */
		readonly retry?: RetryPolicy<any>;

		/**
		 * Optional execution timeout for the forward `run` action.
		 */
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
	readonly run: (context: any) => Task.Result<any, any>;
	readonly undo?: (output: any, context: any) => Task.Result<any, any>;
	readonly retry?: RetryPolicy<any>;
	readonly timeout?: { readonly duration: Duration; readonly onTimeout: () => any; };
};

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
	readonly undo: (output: unknown, context: unknown) => Task.Result<unknown, unknown>;
	readonly output: unknown;
	readonly context: Record<string, unknown>;
};

const drainUndoStack = async (
	undoStack: readonly UndoItem[],
	options: Transaction.RunOptions | undefined,
): Promise<readonly Transaction.UndoFailure[]> => {
	const undoErrors: Transaction.UndoFailure[] = [];

	for (let j = undoStack.length - 1; j >= 0; j--) {
		const item = undoStack[j];
		try {
			// Compensations run uncancelled to guarantee side-effect rollback:
			let undoTask: Task.Result<unknown, unknown>;
			try {
				undoTask = item.undo(item.output, item.context);
			} catch (thrown) {
				undoTask = () => Deferred.from.Promise(globalThis.Promise.resolve(Result.make.err(thrown)));
			}

			const undoOutcome = await Deferred.to.Promise(undoTask(undefined));

			if (Result.is.err(undoOutcome)) {
				const errRecord = { stepId: item.id, error: undoOutcome.error };
				undoErrors.push(errRecord);
				if (options?.onUndo) {
					try {
						options.onUndo(errRecord);
					} catch {
						// Telemetry errors must never disrupt rollback sequence
					}
				}
			} else if (options?.onUndo) {
				try {
					options.onUndo({ stepId: item.id });
				} catch {
					// Telemetry errors must never disrupt rollback sequence
				}
			}
		} catch (thrown) {
			const errRecord = { stepId: item.id, error: thrown };
			undoErrors.push(errRecord);
			if (options?.onUndo) {
				try {
					options.onUndo(errRecord);
				} catch {
					// Telemetry errors must never disrupt rollback sequence
				}
			}
		}
	}

	return Object.freeze(undoErrors);
};

// =============================================================================
// Public Constructors & Combinators
// =============================================================================

/**
 * Creates an empty, initialized `Transaction` ready to accumulate steps.
 *
 * @template In - The initial payload supplied to `Transaction.run`. Defaults to `void`.
 *
 * @see {@link Transaction.step} for appending sequential steps to the transaction.
 *
 * @example
 * ```ts
 * // Zero-argument transaction:
 * const pingTransaction = Transaction.make();
 *
 * // Parameterized transaction:
 * const orderTransaction = Transaction.make<OrderInput>();
 * ```
 */
const makeTransaction = <In = void>(): Transaction<In, Record<never, never>, never, never> => {
	const tx = { kind: "Transaction" as const, [_internalTransaction]: { steps: Object.freeze([]) } };
	return tx as unknown as Transaction<In, Record<never, never>, never, never>;
};

/**
 * Appends a step to a `Transaction`.
 *
 * The step receives an accumulated context containing the initial input and all outputs
 * from preceding steps. An optional compensating `undo` action can be defined to reverse
 * any external mutations if this or any subsequent step fails.
 *
 * Supports optional `retry` and `timeout` resilience policies on forward execution.
 *
 * @see {@link Transaction.run} for executing the compiled transaction.
 *
 * @example
 * ```ts
 * const transaction = pipe(
 *   Transaction.make<OrderInput>(),
 *   Transaction.step({
 *     id: "inventory",
 *     run: ({ initial }) => reserveInventory(initial.sku),
 *     undo: (reservation) => releaseInventory(reservation.id),
 *   }),
 * );
 * ```
 */
const step =
	<
		In = void,
		Acc extends Record<string, unknown> = Record<never, never>,
		Id extends string = string,
		Out = unknown,
		E2 = never,
		EUndo2 = never,
		ETimeout = never,
	>(config: Transaction.StepConfig<In, Acc, Id, Out, E2, EUndo2, ETimeout>) =>
	<E1 = never, EUndo1 = never>(
		transaction: Transaction<In, Acc, E1, EUndo1>,
	): Transaction<In, Acc & { readonly [K in Id]: Out; }, E1 | E2 | ETimeout, EUndo1 | EUndo2> => {
		if (!transaction || (transaction as { readonly kind?: unknown; }).kind !== "Transaction") {
			throw new TypeError("[Transaction.step] Expected a valid Transaction instance.");
		}

		if (!config || typeof config.id !== "string" || config.id.length === 0) {
			throw new TypeError("[Transaction.step] A non-empty string 'id' is required.");
		}

		if (config.id === "initial") {
			throw new TypeError("[Transaction.step] Step id cannot be 'initial' as it is a reserved context key.");
		}

		if (typeof config.run !== "function") {
			throw new TypeError(`[Transaction.step] Step '${config.id}' requires a 'run' function.`);
		}

		if (config.undo !== undefined && typeof config.undo !== "function") {
			throw new TypeError(`[Transaction.step] Step '${config.id}' 'undo' must be a function if provided.`);
		}

		const internal = toInternal(transaction)[_internalTransaction];
		for (let i = 0; i < internal.steps.length; i++) {
			if (internal.steps[i].id === config.id) {
				throw new Error(
					`[Transaction.step] Duplicate step id '${config.id}' detected. Every step in a Transaction must have a unique id.`,
				);
			}
		}

		const newSteps = internal.steps.concat({
			id: config.id,
			run: config.run,
			undo: config.undo,
			retry: config.retry,
			timeout: config.timeout,
		});

		const nextTx = { kind: "Transaction" as const, [_internalTransaction]: { steps: Object.freeze(newSteps) } };

		return nextTx as unknown as Transaction<In, Acc & { readonly [K in Id]: Out; }, E1 | E2 | ETimeout, EUndo1 | EUndo2>;
	};

const isRunOptions = (value: unknown): value is Transaction.RunOptions => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	const keys = Object.keys(value);
	if (keys.length === 0) {
		return false;
	}

	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		if (key !== "signal" && key !== "onStepSuccess" && key !== "onStepFailure" && key !== "onUndo") {
			return false;
		}
	}

	const record = value as Record<string, unknown>;

	if (
		"signal" in record && (typeof record.signal !== "object" || record.signal === null || !("aborted" in record.signal))
	) {
		return false;
	}
	if ("onStepSuccess" in record && typeof record.onStepSuccess !== "function") {
		return false;
	}
	if ("onStepFailure" in record && typeof record.onStepFailure !== "function") {
		return false;
	}
	if ("onUndo" in record && typeof record.onUndo !== "function") {
		return false;
	}

	return true;
};

/**
 * Executes a Transaction, returning an infallible lazy `Task.Result`.
 *
 * Steps run sequentially. If all steps succeed, returns `Ok(Acc)` containing all step outputs.
 * If any step fails, throws, or is aborted, completed steps are undone in reverse (LIFO) order
 * and returns `Err(Transaction.Failure)`.
 *
 * @see {@link Transaction.step} for configuring transactional steps with compensating undo actions.
 *
 * @example
 * ```ts
 * const outcome = await pipe(
 *   checkoutTransaction,
 *   Transaction.run(orderInput, { signal }),
 * )();
 * ```
 */
/**
 * Executes a zero-input Transaction with optional run options.
 */
function runTransaction(
	options?: Transaction.RunOptions,
): <Acc extends Record<string, unknown> = Record<never, never>, E = never, EUndo = never>(
	transaction: Transaction<void, Acc, E, EUndo>,
) => Task.Result<Transaction.Failure<E, EUndo>, Acc>;

/**
 * Executes a parameterized Transaction with input and optional run options.
 */
function runTransaction<In>(
	input: In,
	options?: Transaction.RunOptions,
): <Acc extends Record<string, unknown> = Record<never, never>, E = never, EUndo = never>(
	transaction: Transaction<[In] extends [undefined] ? void : In, Acc, E, EUndo>,
) => Task.Result<Transaction.Failure<E, EUndo>, Acc>;

function runTransaction(
	inputOrOptions?: unknown,
	maybeOptions?: Transaction.RunOptions,
): (transaction: Transaction<any, any, any, any>) => Task.Result<any, any> {
	let input: unknown;
	let options: Transaction.RunOptions | undefined;

	if (maybeOptions !== undefined) {
		input = inputOrOptions;
		options = maybeOptions;
	} else if (isRunOptions(inputOrOptions)) {
		input = undefined;
		options = inputOrOptions;
	} else {
		input = inputOrOptions;
		options = undefined;
	}

	return <Acc extends Record<string, unknown>, E, EUndo>(
		transaction: Transaction<any, Acc, E, EUndo>,
	): Task.Result<Transaction.Failure<E, EUndo>, Acc> =>
	(callerSignal) =>
		Deferred.from.Promise((async () => {
			if (!transaction || (transaction as { readonly kind?: unknown; }).kind !== "Transaction") {
				return Result.make.err({
					kind: "TransactionFailure" as const,
					stepId: "initial",
					error: new TypeError("[Transaction.run] Expected a valid Transaction instance.") as E,
					undoErrors: [],
				});
			}

			const internal = toInternal(transaction)[_internalTransaction];

			// Active cancellation combines caller signal and explicit option signal:
			const activeSignal = callerSignal && options?.signal
				? AbortSignal.any([callerSignal, options.signal])
				: (callerSignal ?? options?.signal);

			if (activeSignal?.aborted) {
				const abortError = activeSignal.reason ?? new Error("[Transaction.run] Aborted before execution");
				return Result.make.err({
					kind: "TransactionFailure" as const,
					stepId: internal.steps[0]?.id ?? "initial",
					error: abortError as E,
					undoErrors: [],
				});
			}

			const context: Record<string, unknown> = {};
			if (input !== undefined) {
				setProperty(context, "initial", input);
			}

			const acc: Record<string, unknown> = {};
			const undoStack: UndoItem[] = [];

			for (let i = 0; i < internal.steps.length; i++) {
				const stepDef = internal.steps[i];

				if (activeSignal?.aborted) {
					const abortError = activeSignal.reason ?? new Error(`[Transaction.run] Aborted before step '${stepDef.id}'`);
					const undoErrors = await drainUndoStack(undoStack, options);
					return Result.make.err({
						kind: "TransactionFailure" as const,
						stepId: stepDef.id,
						error: abortError as E,
						undoErrors: undoErrors as readonly Transaction.UndoFailure<EUndo>[],
					});
				}

				// Wrap step execution in a lazy task to ensure re-invocation on retry
				// and guarantee that synchronous throws are captured safely:
				const stepTask: Task.Result<unknown, unknown> = (signal) => {
					try {
						const task = stepDef.run(context);
						return task(signal);
					} catch (thrown) {
						return Deferred.from.Promise(globalThis.Promise.resolve(Result.make.err(thrown)));
					}
				};

				let effectiveTask = stepTask;

				if (stepDef.retry) {
					effectiveTask = Task.Result.retry(stepDef.retry)(effectiveTask);
				}
				if (stepDef.timeout) {
					effectiveTask = Task.Result.timeout(stepDef.timeout)(effectiveTask);
				}

				let stepOutcome: Result<unknown, unknown>;
				try {
					stepOutcome = await Deferred.to.Promise(effectiveTask(activeSignal));
				} catch (thrown) {
					stepOutcome = Result.make.err(thrown);
				}

				if (Result.is.err(stepOutcome)) {
					if (options?.onStepFailure) {
						try {
							options.onStepFailure({ stepId: stepDef.id, error: stepOutcome.error });
						} catch {
							// Telemetry errors must never disrupt rollback sequence
						}
					}

					const undoErrors = await drainUndoStack(undoStack, options);
					return Result.make.err({
						kind: "TransactionFailure" as const,
						stepId: stepDef.id,
						error: stepOutcome.error as E,
						undoErrors: undoErrors as readonly Transaction.UndoFailure<EUndo>[],
					});
				}

				const out = stepOutcome.value;
				if (options?.onStepSuccess) {
					try {
						options.onStepSuccess({ stepId: stepDef.id, output: out });
					} catch {
						// Telemetry errors must never disrupt forward progression
					}
				}

				setProperty(acc, stepDef.id, out);
				setProperty(context, stepDef.id, out);

				if (stepDef.undo) {
					undoStack.push({ id: stepDef.id, undo: stepDef.undo, output: out, context: Object.freeze({ ...context }) });
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
	 * Creates an empty, initialized `Transaction` ready to accumulate steps.
	 *
	 * @see {@link Transaction.step} for appending sequential steps to the transaction.
	 *
	 * @example
	 * ```ts
	 * const checkout = Transaction.make<OrderInput>();
	 * ```
	 */
	make: makeTransaction,

	/**
	 * Appends a step to a `Transaction` with an optional compensating `undo` action.
	 *
	 * The step receives an accumulated context containing the initial input and all outputs
	 * from preceding steps. An optional compensating `undo` action can be defined to reverse
	 * external mutations if this or any subsequent step fails.
	 *
	 * @see {@link Transaction.run} for executing the compiled transaction.
	 *
	 * @example
	 * ```ts
	 * const withStep = pipe(
	 *   transaction,
	 *   Transaction.step({
	 *     id: "inventory",
	 *     run: ({ initial }) => reserveInventory(initial.sku),
	 *     undo: (res) => releaseInventory(res.id),
	 *   }),
	 * );
	 * ```
	 */
	step,

	/**
	 * Executes a `Transaction`, returning an infallible lazy `Task.Result`.
	 *
	 * Steps run sequentially. If all steps succeed, returns `Ok(Acc)` containing all step outputs.
	 * If any step fails, times out, or is aborted, completed steps are undone in reverse (LIFO) order
	 * and returns `Err(Transaction.Failure)`.
	 *
	 * @see {@link Transaction.step} for configuring transactional steps with compensating undo actions.
	 *
	 * @example
	 * ```ts
	 * const outcome = await pipe(
	 *   checkout,
	 *   Transaction.run(orderInput, { signal }),
	 * )();
	 * ```
	 */
	run: runTransaction,
};
