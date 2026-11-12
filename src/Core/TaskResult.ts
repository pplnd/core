import type { KeysOfUnion, Thenable } from "../internal/InternalTypes";
import { toPositiveInteger } from "../internal/Numbers.ts";
import { clampTimerDelay } from "../internal/timers.ts";
import { waitForDelay } from "../internal/waitForDelay.ts";
import { Duration } from "../Types/Duration.ts";
import type { RetryPolicy } from "../Types/RetryPolicy.ts";
import { Aborted } from "./Aborted.ts";
import { Deferred } from "./Deferred.ts";
import { type Maybe, Maybe as CoreMaybe } from "./Maybe.ts";
import { type Result, Result as CoreResult } from "./Result.ts";
import { Task } from "./Task.ts";

const makeOk = <A>(value: A): Task.Result<never, A> => Task.make(CoreResult.make.ok(value));
const makeErr = <const E>(error: E): Task.Result<E, never> => Task.make(CoreResult.make.err(error));

type TaskErrOf<T> = T extends Task.Result<infer E, unknown> ? E : never;

const mapTaskResult = <A, B>(transform: (value: A) => B) => <E = never>(task: Task.Result<E, A>): Task.Result<E, B> =>
	Task.map(CoreResult.map<A, B>(transform))(task);

const chainTaskResult =
	<E2 = never, A = unknown, B = unknown>(transform: (value: A) => Task.Result<E2, B>) =>
	<E1 = never>(task: Task.Result<E1, A>): Task.Result<E1 | E2, B> =>
		Task.chain((result: Result<E1, A>) =>
			CoreResult.is.ok(result)
				? transform(result.value)
				: Task.make(CoreResult.make.err(result.error) as Result<E1 | E2, B>)
		)(task);

export const TaskResult = {
	make: {
		/**
		 * Wraps a value in a successful Task.Result.
		 *
		 * @example
		 * ```ts
		 * const task = Task.Result.make.ok(42);
		 * const res = await task(); // Ok(42)
		 * ```
		 */
		ok: makeOk,

		/**
		 * Creates a failed Task.Result with the given error.
		 *
		 * @example
		 * ```ts
		 * const task = Task.Result.make.err("failed");
		 * const res = await task(); // Err("failed")
		 * ```
		 */
		err: makeErr,
	},

	// --- from ---
	from: {
		/**
		 * Creates a Task.Result from a nullable value.
		 * Returns Ok if the value is not null or undefined, err from onNull otherwise.
		 *
		 * @example
		 * ```ts
		 * Task.Result.from.nullable(() => "missing")(42);   // resolves to Ok(42)
		 * Task.Result.from.nullable(() => "missing")(null); // resolves to Err("missing")
		 * ```
		 */
		nullable: <const E>(onNull: () => E) => <A>(value: A | null | undefined): Task.Result<E, NonNullable<A>> =>
			Task.make(
				value === null || value === undefined ? CoreResult.make.err(onNull()) : CoreResult.make.ok(value as NonNullable<A>),
			),

		/**
		 * Creates a Task.Result from a Maybe.
		 * Some becomes Ok, None becomes err from onNone.
		 *
		 * @example
		 * ```ts
		 * Task.Result.from.Maybe(() => "empty")(Maybe.make.some(42)); // resolves to Ok(42)
		 * Task.Result.from.Maybe(() => "empty")(Maybe.make.none());   // resolves to Err("empty")
		 * ```
		 */
		Maybe: <const E>(onNone: () => E) => <A>(maybe: Maybe<A>): Task.Result<E, A> =>
			Task.make(CoreMaybe.is.none(maybe) ? CoreResult.make.err(onNone()) : CoreResult.make.ok(maybe.value)),

		/**
		 * Lifts a Result into a Task.Result.
		 *
		 * @example
		 * ```ts
		 * Task.Result.from.Result(Result.make.ok(42)); // resolves to Ok(42)
		 * ```
		 */
		Result: <E, A>(result: Result<E, A>): Task.Result<E, A> => Task.make(result),

		/**
		 * Lifts an infallible Task into a Task.Result with error type `never`.
		 *
		 * @example
		 * ```ts
		 * Task.Result.from.Task(Task.make(42)); // resolves to Ok(42)
		 * ```
		 */
		Task: <A>(task: Task<A>): Task.Result<never, A> => (signal?: AbortSignal) =>
			Deferred.from.Promise(Deferred.to.Promise(task(signal)).then((val) => CoreResult.make.ok(val))),
	},

	// --- to ---
	to: {
		/**
		 * Converts a Task.Result to a Task.Maybe, dropping the error value on Err.
		 *
		 * @example
		 * ```ts
		 * const taskResult = Task.Result.make.ok(42);
		 * const taskMaybe = pipe(taskResult, Task.Result.to.Maybe);
		 * ```
		 */
		Maybe: <E, A>(task: Task.Result<E, A>): Task.Maybe<A> => Task.map(CoreResult.to.Maybe)(task),
	},

	/**
	 * Creates a Task.Result from a Promise-returning thunk that may throw or reject.
	 * Catches any errors and transforms them using the `onError` function into an `Err`.
	 * The thunk optionally receives an `AbortSignal` forwarded from the call site.
	 *
	 * @example
	 * ```ts
	 * const loadUser = Task.Result.tryCatch(
	 *   (signal) => userStore.get("u_123", { signal }),
	 *   { onError: (e) => new DbError(e) }
	 * );
	 * ```
	 */
	tryCatch:
		<const E, A>(
			fn: (signal?: AbortSignal) => Thenable<A>,
			options: { onError: (error: unknown) => E; },
		): Task.Result<E, A> =>
		(signal) =>
			Deferred.from.Promise(
				// oxlint-disable-next-line require-await
				globalThis.Promise.resolve().then(async () => fn(signal)).then(CoreResult.make.ok).catch((error) =>
					CoreResult.make.err(options.onError(error))
				),
			),

	/**
	 * Transforms the success value inside a Task.Result.
	 *
	 * @see {@link Task.Result.chain} to sequence operations that themselves return a Task.Result.
	 * @see {@link Task.Result.mapError} to transform the error value instead of the success value.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   Task.Result.make.ok(5),
	 *   Task.Result.map(n => n * 2),
	 * ); // Task.Result resolving to Ok(10)
	 * ```
	 */
	map: mapTaskResult,

	/**
	 * Transforms the error value inside a Task.Result.
	 *
	 * @see {@link Task.Result.map} to transform the success value instead of the error value.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   Task.Result.make.err("not found"),
	 *   Task.Result.mapError(e => `Error: ${e}`),
	 * ); // Task.Result resolving to Err("Error: not found")
	 * ```
	 */
	mapError: <E, F>(transform: (error: E) => F) => <A = never>(task: Task.Result<E, A>): Task.Result<F, A> =>
		Task.map(CoreResult.mapError<E, F>(transform))(task),

	/**
	 * Chains Task.Result computations. If the first succeeds, passes the value to transform.
	 * If the first fails, propagates the error.
	 *
	 * @see {@link Task.Result.map} to transform the inner value without returning a new Task.Result.
	 *
	 * @example
	 * ```ts
	 * const loadUserId: Task.Result<string, number> = Task.Result.make.ok(42);
	 * const loadProfile = (id: number): Task.Result<string, { id: number; name: string }> =>
	 *   Task.Result.make.ok({ id, name: "Alice" });
	 *
	 * pipe(
	 *   loadUserId,
	 *   Task.Result.chain(loadProfile),
	 * ); // Task.Result resolving to Ok({ id: 42, name: "Alice" })
	 * ```
	 */
	chain: chainTaskResult,

	/**
	 * Pattern matches on a Task.Result, returning a Task of the result.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   Task.Result.make.ok(42),
	 *   Task.Result.match({
	 *     err: e => `Error: ${e}`,
	 *     ok: v => `Got ${v}`,
	 *   }),
	 * ); // Task resolving to "Got 42"
	 * ```
	 */
	match: <E, A, B>(cases: { err: (error: E) => B; ok: (value: A) => B; }) => (task: Task.Result<E, A>): Task<B> =>
		Task.map(CoreResult.match<E, A, B>(cases))(task),

	/**
	 * Recovers from an error by providing a fallback Task.Result.
	 * The fallback can produce a different success type or resolve with a different error type.
	 *
	 * @see {@link Task.Result.recoverUnless} to conditionally recover based on the error value.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   Task.Result.make.err("disk error"),
	 *   Task.Result.recover(() => Task.Result.make.ok("cached value")),
	 * ); // Task.Result resolving to Ok("cached value")
	 * ```
	 */
	recover:
		<E1, E2 = never, B = never>(fallback: (error: E1) => Task.Result<E2, B>) =>
		<A = never>(task: Task.Result<E1, A>): Task.Result<E2, A | B> =>
			Task.chain((result: Result<E1, A>) =>
				CoreResult.is.err(result) ? fallback(result.error) : Task.make(result as Result<E2, A | B>)
			)(task as Task<Result<E1, A>>),

	/**
	 * Recovers from an error unless the predicate `isBlocked` returns true for that error.
	 * The fallback can produce a different success type, widening the result to `Task.Result<E1 | E2, A | B>`.
	 *
	 * @see {@link Task.Result.recover} for unconditional error recovery.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   fetchTask,
	 *   Task.Result.recoverUnless(
	 *     (e) => e === "fatal",
	 *     () => Task.Result.make.ok("fallback")
	 *   )
	 * );
	 * ```
	 */
	recoverUnless:
		<E1, E2 = never, B = never>(isBlocked: (error: E1) => boolean, fallback: (error: E1) => Task.Result<E2, B>) =>
		<A = never>(task: Task.Result<E1, A>): Task.Result<E1 | E2, A | B> =>
			Task.chain((result: Result<E1, A>) =>
				CoreResult.is.err(result) && !isBlocked(result.error)
					? fallback(result.error)
					: Task.make(result as Result<E1 | E2, A | B>)
			)(task as Task<Result<E1, A>>),

	/**
	 * Returns the success value or a default value if the Task.Result is an error.
	 * The default can be a different type, widening the result to `Task<A | B>`.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   Task.Result.make.err("oops"),
	 *   Task.Result.getOrElse(() => 0),
	 * ); // Task resolving to 0
	 * ```
	 */
	getOrElse: <B>(fallback: () => B) => <A = never, E = never>(task: Task.Result<E, A>): Task<A | B> =>
		Task.map(CoreResult.getOrElse<B>(fallback))(task),

	/**
	 * Executes a side effect on the success value without changing the Task.Result.
	 * Useful for logging or debugging.
	 *
	 * @see {@link Task.Result.tapError} to perform a side effect on the error value.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   Task.Result.make.ok({ status: "done" }),
	 *   Task.Result.tap(v => console.log("Success:", v)),
	 * );
	 * ```
	 */
	tap: <A>(sideEffect: (value: A) => void) => <E = never>(task: Task.Result<E, A>): Task.Result<E, A> =>
		Task.map(CoreResult.tap<A>(sideEffect))(task),

	/**
	 * Executes a side effect on the error value without changing the Task.Result.
	 * Useful for logging or reporting async errors.
	 *
	 * @see {@link Task.Result.tap} to perform a side effect on the success value.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   fetchUser(id),
	 *   Task.Result.tapError(e => console.error("fetch failed:", e)),
	 *   Task.Result.chain(saveToCache),
	 * )
	 * ```
	 */
	tapError: <E>(sideEffect: (error: E) => void) => <A = never>(task: Task.Result<E, A>): Task.Result<E, A> =>
		Task.map(CoreResult.tapError<E>(sideEffect))(task),

	/**
	 * Applies a function wrapped in a Task.Result to a value wrapped in a Task.Result.
	 * Both Tasks run in parallel.
	 *
	 * @example
	 * ```ts
	 * const add = (a: number) => (b: number) => a + b;
	 * pipe(
	 *   Task.Result.make.ok(add),
	 *   Task.Result.apply(Task.Result.make.ok(5)),
	 *   Task.Result.apply(Task.Result.make.ok(3)),
	 * ); // Task.Result resolving to Ok(8)
	 * ```
	 */
	apply:
		<E2 = never, A = never>(arg: Task.Result<E2, A>) =>
		<B, E1 = never>(task: Task.Result<E1, (value: A) => B>): Task.Result<E1 | E2, B> =>
		(signal) =>
			Deferred.from.Promise(
				Promise.all([Deferred.to.Promise(task(signal)), Deferred.to.Promise(arg(signal))]).then(([of_, oa]) =>
					CoreResult.apply(oa)(of_)
				),
			),

	/**
	 * Executes a `Task.Result` with an optional signal, returning `Deferred<Result<E, A>>`.
	 * Use as a terminal step in a `pipe` chain.
	 *
	 * @example
	 * ```ts
	 * const controller = new AbortController();
	 * const result = await pipe(
	 *     fetchUser("42"),
	 *     Task.Result.chain(user => fetchPosts(user.id)),
	 *     Task.Result.run(controller.signal),
	 * );
	 * if (Result.is.ok(result)) render(result.value);
	 * ```
	 */
	run: (signal?: AbortSignal) => <E, A>(task: Task.Result<E, A>): Deferred<Result<E, A>> => task(signal),

	/**
	 * Converts a Task.Result value into an object containing a single property.
	 * Initiates the pipeline accumulator record.
	 *
	 * @example
	 * ```ts
	 * pipe(Task.Result.make.ok(42), Task.Result.assignTo("value")); // Task.Result({ value: 42 })
	 * ```
	 */
	assignTo:
		<K extends string>(key: K) => <E = never, A = unknown>(task: Task.Result<E, A>): Task.Result<E, { [P in K]: A; }> =>
			mapTaskResult<A, { [P in K]: A; }>((value) => ({ [key]: value } as { [P in K]: A; }))(task),

	/**
	 * Evaluates a new Task.Result using the current accumulator and attaches the output to a new key.
	 *
	 * Evaluates a new fallible Task using the current accumulator and attaches the output to a new key.
	 * The key must not already exist on the accumulator — use `map` to update an existing field.
	 * The accumulator is expected to be a plain object (own enumerable properties).
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   Task.Result.make.ok({ a: 1 }),
	 *   Task.Result.assign("b", ({ a }) => Task.Result.make.ok(a + 1))
	 * ); // Task.Result({ a: 1, b: 2 })
	 * ```
	 */
	assign:
		<K extends string, E2, A extends object, B>(
			key: K extends KeysOfUnion<A> ? never : K,
			transform: (value: A) => Task.Result<E2, B>,
		) =>
		<E1 = never>(task: Task.Result<E1, A>): Task.Result<E1 | E2, A & { [P in K]: B; }> =>
			chainTaskResult<E2, A, A & { [P in K]: B; }>((acc) =>
				mapTaskResult<B, A & { [P in K]: B; }>((val) => {
					const accumulator = { ...(acc as unknown as Record<string, unknown>), [key]: val } as A & { [P in K]: B; };
					return accumulator;
				})(transform(acc))
			)(task),

	/**
	 * Combines a record of Task.Results into a single Task.Result of a record. Own string and symbol keys are processed in key order; inherited fields are not supported.
	 * Evaluates all tasks in parallel, forwarding the AbortSignal down to each sub-task.
	 * Returns the first Err encountered in key order.
	 *
	 * @example
	 * ```ts
	 * Task.Result.struct({
	 *   name: Task.Result.make.ok("Alice"),
	 *   age: Task.Result.make.ok(30)
	 * }); // Task.Result({ name: "Alice", age: 30 })
	 * ```
	 */
	struct:
		<T extends Record<string, Task.Result<unknown, unknown>>>(
			fields: T,
		): Task.Result<TaskErrOf<T[keyof T]>, { [K in keyof T]: T[K] extends Task.Result<unknown, infer A> ? A : never; }> =>
		(signal) =>
			Deferred.from.Promise((() => {
				type E = TaskErrOf<T[keyof T]>;
				type R = { [K in keyof T]: T[K] extends Task.Result<unknown, infer A> ? A : never; };
				type StructResult = Result<E, R>;
				const keys = Reflect.ownKeys(fields);
				const len = keys.length;
				const promises = new Array<Promise<Result<unknown, unknown>>>(len);
				for (let i = 0; i < len; i++) {
					promises[i] = Deferred.to.Promise(fields[keys[i] as keyof T](signal));
				}
				return Promise.all(promises).then((results) => {
					const record = {} as R;
					for (let i = 0; i < len; i++) {
						const res = results[i];
						if (CoreResult.is.err(res)) {
							return res as unknown as StructResult;
						}
						record[keys[i] as keyof R] = res.value as R[keyof R];
					}
					return CoreResult.make.ok(record) as StructResult;
				});
			})()),

	/**
	 * Retries a fallible Task.Result according to a RetryPolicy.
	 * If the task succeeds, returns Ok immediately.
	 * If the task fails, retries until `policy.attempts` total attempts are spent, with delays
	 * generated by the policy.
	 * Any optional `when` predicate or `onRetry` callback configured on the `RetryPolicy`
	 * will filter retriable errors and emit telemetry events before each backoff delay.
	 *
	 * The policy is built before the pipeline, so annotate it — `RetryPolicy<CheckoutError>` —
	 * and its `when` and `onRetry` callbacks see the task's exact error union. An inline,
	 * unannotated policy widens those callbacks to `unknown`, and a policy typed narrower than
	 * the task's union is rejected at the call.
	 *
	 * @see {@link RetryPolicy} for the attempts contract.
	 *
	 * @example
	 * ```ts
	 * const policy: RetryPolicy<FetchError> = RetryPolicy.exponential({
	 *   attempts: 3,
	 *   initial: Duration.milliseconds(100),
	 *   when: (err) => isTransient(err),
	 *   onRetry: ({ attempt, error, delay }) => console.warn(`Retry ${attempt}: ${error}`),
	 * });
	 * const retryableFetch = pipe(
	 *   fetchData,
	 *   Task.Result.retry(policy),
	 * );
	 * ```
	 */
	retry:
		<E = unknown>(policy: RetryPolicy<E>) =>
		<E1 extends E = E, A = unknown>(task: Task.Result<E1, A>): Task.Result<E1, A> =>
		(signal) =>
			Deferred.from.Promise((() => {
				const { attempts: rawAttempts, when: shouldRetry, onRetry: onRetryCallback } = policy;
				const attempts = toPositiveInteger(rawAttempts) ?? 1;

				const wait = (duration: Duration): Promise<void> => waitForDelay(Duration.to.milliseconds(duration), signal);

				const executeAttempt = (attempt: number): Promise<Result<E1, A>> =>
					Deferred.to.Promise(task(signal)).then((res) => {
						if (CoreResult.is.ok(res) || attempt >= attempts || signal?.aborted) {
							return res;
						}
						if (shouldRetry && !shouldRetry(res.error)) { return res; }
						const delay = policy.getDelay(attempt);
						onRetryCallback?.({ attempt, error: res.error, delay });
						return wait(delay).then(() => signal?.aborted ? res : executeAttempt(attempt + 1));
					});

				return executeAttempt(1);
			})()),

	/**
	 * Runs a cursor-driven loader until a page reports no `next` cursor, collecting every item.
	 *
	 * Pages are requested sequentially, because each cursor comes from the page before it. The
	 * first `Err` ends the run and returns that error; pages already collected are not returned.
	 * The loader receives the caller's signal, and the run settles with `Aborted` when the signal
	 * aborts before the next page starts.
	 *
	 * @see {@link Task.Result.all} to run independent tasks instead of a cursor chain.
	 * @see {@link Task.Result.poll} to repeat one task until its value is ready.
	 *
	 * @example
	 * ```ts
	 * const loadAllIssues = Task.Result.paginate(fetchIssuePage);
	 *
	 * const issues = await loadAllIssues();
	 * if (Result.is.ok(issues)) {
	 *   console.log(issues.value.length);
	 * }
	 * ```
	 */
	paginate:
		<E, A, C>(
			load: (cursor: C | undefined) => Task.Result<E, { readonly items: readonly A[]; readonly next?: C; }>,
		): Task.Result<E | Aborted, readonly A[]> =>
		(signal) =>
			Deferred.from.Promise((() => {
				const items: A[] = [];

				const run = (cursor: C | undefined): Promise<Result<E | Aborted, readonly A[]>> => {
					if (signal?.aborted) {
						return globalThis.Promise.resolve(CoreResult.make.err(Aborted.make(signal.reason)));
					}
					return Deferred.to.Promise(load(cursor)(signal)).then((page) => {
						if (!CoreResult.is.ok(page)) {
							return CoreResult.make.err(page.error);
						}
						const pageItems = page.value.items;
						for (let i = 0; i < pageItems.length; i++) {
							items.push(pageItems[i]);
						}
						if (page.value.next === undefined) {
							return CoreResult.make.ok(items);
						}
						return run(page.value.next);
					});
				};

				return run(undefined);
			})()),

	/**
	 * Repeats a fallible task until its value satisfies `until`, keeping the value that satisfied it.
	 *
	 * `until`, `delay`, and `attempts` behave exactly as they do in `Task.poll`: `attempts` is a
	 * positive integer, and the last value is returned when it runs out. The difference is the error
	 * channel: the first `Err` ends the loop, because retrying a failed attempt belongs to
	 * `Task.Result.retry`.
	 *
	 * @see {@link Task.poll} for the infallible form.
	 * @see {@link Task.Result.retry} to repeat a failed attempt rather than a successful one.
	 *
	 * @example
	 * ```ts
	 * const waitForExport = pipe(
	 *   fetchExportJob,
	 *   Task.Result.poll({ until: (job) => job.status !== "pending", delay: Duration.seconds(2) }),
	 * );
	 * ```
	 */
	poll:
		<A>(options: { readonly until: (value: A) => boolean; readonly delay?: Duration; readonly attempts?: number; }) =>
		<E = never>(task: Task.Result<E, A>): Task.Result<E, A> =>
		(signal) =>
			Deferred.from.Promise((() => {
				const { until: predicate, delay: delayDuration } = options;
				const attempts = options.attempts === undefined ? undefined : (toPositiveInteger(options.attempts) ?? 1);

				const wait = (): Promise<void> => waitForDelay(delayDuration ? Duration.to.milliseconds(delayDuration) : 0, signal);

				const executeAttempt = (attempt: number): Promise<Result<E, A>> =>
					Deferred.to.Promise(task(signal)).then((res) => {
						if (!CoreResult.is.ok(res)) {
							return res;
						}
						if (predicate(res.value)) {
							return res;
						}
						if (attempts !== undefined && attempt >= attempts) {
							return res;
						}
						if (signal?.aborted) {
							return res;
						}
						return wait().then(() => signal?.aborted ? res : executeAttempt(attempt + 1));
					});

				return executeAttempt(1);
			})()),

	/**
	 * Times out a fallible task, resolving to `Err(onTimeout())` if the duration elapses
	 * before the task completes.
	 *
	 * @example
	 * ```ts
	 * const fetchWithTimeout = pipe(
	 *   fetchTask,
	 *   Task.Result.timeout({ duration: Duration.seconds(5), onTimeout: () => "Request timed out" })
	 * );
	 * ```
	 */
	timeout:
		<const E2>(options: { duration: Duration; onTimeout: () => E2; }) =>
		<E1 = never, A = unknown>(task: Task.Result<E1, A>): Task.Result<E1 | E2, A> =>
		(outerSignal) =>
			Deferred.from.Promise((() => {
				const controller = new AbortController();
				let timerId: ReturnType<typeof setTimeout> | undefined;

				const onOuterAbort = () => {
					controller.abort();
				};

				const cleanUp = () => {
					clearTimeout(timerId);
					outerSignal?.removeEventListener("abort", onOuterAbort);
				};

				if (outerSignal) {
					if (outerSignal.aborted) {
						controller.abort();
					} else {
						outerSignal.addEventListener("abort", onOuterAbort, { once: true });
					}
				}

				return Promise.race([
					Deferred.to.Promise(task(controller.signal)).then((res): Result<E1 | E2, A> => {
						cleanUp();
						return res;
					}),
					new Promise<Result<E1 | E2, A>>((resolve) => {
						timerId = setTimeout(() => {
							cleanUp();
							resolve(CoreResult.make.err(options.onTimeout()));
							controller.abort();
						}, clampTimerDelay(Duration.to.milliseconds(options.duration)));
					}),
				]);
			})()),

	/**
	 * Runs multiple fallible tasks in parallel and collects their successful values into a tuple.
	 *
	 * - An optional `concurrency` option limits the number of tasks executing at any given time;
	 *   a provided nonpositive or non-integer value clamps to 1, and omitting the option runs all
	 *   tasks unbounded.
	 * - Short-circuits on the first `Err`: cancels all currently active tasks and avoids starting queued tasks.
	 * - If caller's `signal` is already aborted, returns `Aborted` immediately without starting work.
	 * - If caller's `signal` aborts during execution, cancels active work and settles immediately with `Aborted`.
	 *
	 * @see {@link Task.Result.sequential} to run an array of fallible tasks one at a time in order.
	 * @see {@link Task.Result.allSettled} to collect all outcomes without short-circuiting on failure.
	 *
	 * @example
	 * ```ts
	 * const result = await Task.Result.all([loadUser, loadPreferences])();
	 * if (Result.is.ok(result)) {
	 *   const [user, preferences] = result.value;
	 * }
	 * ```
	 */
	all:
		<T extends readonly Task.Result<unknown, unknown>[]>(
			tasks: readonly [...T],
			options?: { concurrency?: number; },
		): Task.Result<
			TaskErrOf<T[number]> | Aborted,
			{ [K in keyof T]: T[K] extends Task.Result<unknown, infer A> ? A : never; }
		> =>
		(callerSignal) =>
			Deferred.from.Promise(
				new Promise<
					Result<
						TaskErrOf<T[number]> | Aborted,
						{ [K in keyof T]: T[K] extends Task.Result<unknown, infer A> ? A : never; }
					>
				>((resolve) => {
					type AllE = TaskErrOf<T[number]> | Aborted;
					type Results = { [K in keyof T]: T[K] extends Task.Result<unknown, infer A> ? A : never; };

					if (callerSignal?.aborted) {
						resolve(CoreResult.make.err(Aborted.make(callerSignal.reason)));
						return;
					}

					const len = tasks.length;
					if (len === 0) {
						resolve(CoreResult.make.ok([] as unknown as Results));
						return;
					}

					const internalController = new AbortController();
					const activeSignal = internalController.signal;

					let isSettled = false;

					// oxlint-disable-next-line prefer-const
					let onCallerAbort: () => void;

					const settle = (result: Result<AllE, Results>): void => {
						isSettled = true;
						if (callerSignal) {
							callerSignal.removeEventListener("abort", onCallerAbort);
						}
						if (CoreResult.is.err(result)) {
							internalController.abort();
						}
						resolve(result);
					};

					onCallerAbort = () => {
						settle(CoreResult.make.err(Aborted.make(callerSignal!.reason)));
					};

					if (callerSignal) {
						callerSignal.addEventListener("abort", onCallerAbort, { once: true });
					}

					const results = new Array(len);
					let nextIndex = 0;
					let completedCount = 0;

					const concurrency = options?.concurrency;
					const maxConcurrency = concurrency === undefined
						? len
						: Number.isInteger(concurrency) && concurrency > 0
						? Math.min(concurrency, len)
						: 1;

					const worker = async (): Promise<void> => {
						// oxlint-disable-next-line no-unmodified-loop-condition
						while (nextIndex < len && !isSettled) {
							const idx = nextIndex++;
							const taskResult = await Deferred.to.Promise(tasks[idx](activeSignal));

							if (isSettled) {
								return;
							}

							if (CoreResult.is.err(taskResult)) {
								settle(taskResult as unknown as Result<AllE, Results>);
								return;
							}

							results[idx] = taskResult.value;
							completedCount++;
							if (completedCount === len) {
								settle(CoreResult.make.ok(results as unknown as Results));
								return;
							}
						}
					};

					const workers = new Array<Promise<void>>(maxConcurrency);
					for (let i = 0; i < maxConcurrency; i++) {
						workers[i] = worker();
					}
				}),
			),

	/**
	 * Runs a list of fallible tasks in parallel and collects all outcomes (`Ok` and `Err`)
	 * without short-circuiting on failure.
	 *
	 * @example
	 * ```ts
	 * const results = await Task.Result.allSettled([task1, task2, task3])();
	 * // [Ok(val1), Err(err2), Ok(val3)]
	 * ```
	 */
	allSettled:
		<T extends readonly Task.Result<any, any>[]>(
			tasks: readonly [...T],
		): Task<{ [K in keyof T]: T[K] extends Task.Result<infer E, infer A> ? Result<E, A> : never; }> =>
		(signal) =>
			Deferred.from.Promise((() => {
				type Results = { [K in keyof T]: T[K] extends Task.Result<infer E, infer A> ? Result<E, A> : never; };
				const len = tasks.length;
				const promises = new Array<Promise<Result<unknown, unknown>>>(len);
				for (let i = 0; i < len; i++) {
					promises[i] = Deferred.to.Promise(tasks[i](signal));
				}
				return Promise.all(promises) as Promise<Results>;
			})()),

	/**
	 * Narrows the Ok value with a predicate or type guard. If the predicate returns false,
	 * converts the value to an Err using onFail.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   Task.Result.make.ok(42),
	 *   Task.Result.ensure(n => n > 50, () => "too small")
	 * ); // Task.Result resolving to Err("too small")
	 * ```
	 */
	ensure:
		(<A, const E2>(predicate: (value: A) => boolean, onFail: (value: A) => E2) =>
		<E1 = never>(task: Task.Result<E1, A>): Task.Result<E1 | E2, A> =>
		(signal) =>
			Deferred.from.Promise(Deferred.to.Promise(task(signal)).then(CoreResult.ensure<A, E2>(predicate, onFail)))) as {
				<A, B extends A, const E2>(
					refinement: (value: A) => value is B,
					onFail: (value: A) => E2,
				): <E1 = never>(task: Task.Result<E1, A>) => Task.Result<E1 | E2, B>;
				<A, const E2>(
					predicate: (value: A) => boolean,
					onFail: (value: A) => E2,
				): <E1 = never>(task: Task.Result<E1, A>) => Task.Result<E1 | E2, A>;
			},

	/**
	 * Maps both the Err and Ok channels simultaneously.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   Task.Result.make.ok(42),
	 *   Task.Result.mapBoth(
	 *     (err: string) => new Error(err),
	 *     (n: number) => n * 2
	 *   )
	 * ); // Task.Result resolving to Ok(84)
	 * ```
	 */
	mapBoth:
		<E1, E2, A, B>(onErr: (error: E1) => E2, onOk: (value: A) => B) =>
		(task: Task.Result<E1, A>): Task.Result<E2, B> =>
		(signal) => Deferred.from.Promise(Deferred.to.Promise(task(signal)).then(CoreResult.mapBoth(onErr, onOk))),
};
