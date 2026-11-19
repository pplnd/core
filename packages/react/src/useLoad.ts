import { Deferred, RemoteData, Result, type Task } from "@pplnd/core";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Options for {@link useLoad}.
 */
export type UseLoadOptions = {
	/**
	 * Re-run the load when these values change (compared with `Object.is`, like `useEffect`
	 * deps). Default: run once on mount.
	 */
	readonly deps?: readonly unknown[];
	/**
	 * Keep the previous `RemoteData` visible as-is while the next run is pending, instead of
	 * resetting to `Loading`. Default: `true` — dashboards stay stable; pass `false` when the
	 * UI must show the skeleton on every key change.
	 */
	readonly keepPrevious?: boolean;
};

/**
 * The load lifecycle, ready for `RemoteData.matchValue` in render — never boolean flags.
 */
export type UseLoadResult<E, A> = {
	/**
	 * The current load state: `NotAsked` before the first run, `Loading` while pending,
	 * `Failure` / `Success` once settled.
	 */
	readonly state: RemoteData<E, A>;
	/**
	 * Restart the task with a fresh signal through the same epoch machinery. Does not touch
	 * the deps array.
	 *
	 * @see {@link useLoad} for the deps-driven lifecycle.
	 */
	readonly reload: () => void;
};

/**
 * Runs a mount-triggered fallible async task and renders its lifecycle as `RemoteData`.
 *
 * The task is a `Task.Result` — it is re-runnable by nature, and the hook owns its
 * `AbortSignal`: on unmount or deps change the signal is aborted and the settling result of
 * any stale run is discarded before it can re-render. StrictMode's double mount is safe —
 * the first run is aborted by cleanup, the second run wins, and a settled result is never
 * applied twice.
 *
 * SSR-safe by construction: `Task` is a lazy thunk, so server render produces `NotAsked` and
 * no request is ever started outside an effect.
 *
 * There is deliberately no query key, no cache, no dedup, no invalidation, and no auto-retry:
 * two components mounting the same task issue two requests, and concurrency strategies or
 * retries belong in the task itself (`Task.Result.retry`, `Task.Result.timeout`) or in an
 * `Op` manager bound with {@link useOp}.
 *
 * @see {@link useOp} for user-triggered runs with concurrency strategies.
 *
 * @example
 * ```tsx
 * function UserProfile({ userId }: { userId: string }) {
 *   const { state, reload } = useLoad(
 *     Task.Result.tryCatch(
 *       (signal) => fetch(`/users/${userId}`, { signal }).then(toUser),
 *       { onError: toUserError },
 *     ),
 *     { deps: [userId] },
 *   );
 *
 *   return RemoteData.matchValue(state, {
 *     notAsked: () => null,
 *     loading: () => <Spinner />,
 *     failure: (error) => <ErrorNotice error={error} onRetry={reload} />,
 *     success: (user) => <Profile user={user} />,
 *   });
 * }
 * ```
 */
export function useLoad<E, A>(load: Task.Result<E, A>, options?: UseLoadOptions): UseLoadResult<E, A> {
	const keepPrevious = options?.keepPrevious ?? true;
	const deps = options?.deps;
	const [state, setState] = useState<RemoteData<E, A>>(RemoteData.make.notAsked());
	const [runNonce, setRunNonce] = useState(0);
	const epochRef = useRef(0);

	useEffect(() => {
		// The closures are fresh per run: this effect body always observes the render that
		// scheduled it, so no render-phase ref mirroring is needed.
		const epoch = ++epochRef.current;
		const controller = new AbortController();
		setState((previous) =>
			keepPrevious && (previous.kind === "Success" || previous.kind === "Failure") ? previous : RemoteData.make.loading()
		);
		void Deferred.to.Promise(load(controller.signal)).then((result) => {
			if (epochRef.current !== epoch) {
				return;
			}
			setState(
				Result.matchValue(result, {
					ok: (value) => RemoteData.make.success(value),
					err: (error) => RemoteData.make.failure(error),
				}),
			);
		});
		return () => controller.abort();
		// Only the deps and the reload nonce drive re-execution.
	}, [...(deps ?? []), runNonce]);

	const reload = useCallback(() => setRunNonce((nonce) => nonce + 1), []);

	return { state, reload };
}
