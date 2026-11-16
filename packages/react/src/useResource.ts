import { Deferred, RemoteData, Resource, Result } from "@pplnd/core";
import { useEffect, useRef, useState } from "react";

/**
 * The bound resource: its acquisition lifecycle as `RemoteData`, ready for
 * `RemoteData.matchValue` in render — there is no separate "acquiring" flag.
 */
export type UseResourceResult<E, A> = {
	/**
	 * `NotAsked` before mount, `Loading` while acquiring, `Failure` with the acquisition
	 * error, `Success` with the acquired value for the component's lifetime.
	 */
	readonly state: RemoteData<E, A>;
};

/**
 * Acquires a `Resource` on mount into a hook-owned scope and releases it on unmount.
 *
 * The scope is one per component instance: everything acquired into it is released in
 * reverse (LIFO) order at disposal, and disposal racing an in-flight acquisition is
 * deterministic — the acquisition settles normally and the asset is released immediately, so
 * StrictMode's mount → unmount → remount never holds two assets or loses a release. The
 * hook-owned `AbortSignal` is forwarded to the acquisition, and a settling result from a
 * discarded mount is dropped before it can re-render.
 *
 * This is the deliberate exception to the binding rule: per-instance assets (a document
 * lock, a session handle) MUST be acquired per mount and released with the component. There
 * is no `reacquire` — React's `key` prop is the native bracket-reset for a changed asset.
 *
 * @see {@link useLoad} for the load lifecycle without a release obligation.
 *
 * @example
 * ```tsx
 * const docLock = Resource.make(
 *   Task.Result.tryCatch((signal) => openDocumentLock(docId, signal), { onError: toLockError }),
 *   (lock) => lock.close(),
 * );
 *
 * function Editor() {
 *   const { state } = useResource(docLock);
 *
 *   return RemoteData.matchValue(state, {
 *     notAsked: () => null,
 *     loading: () => <Spinner />,
 *     failure: (error) => <LockError error={error} />,
 *     success: () => <EditorSurface />,
 *   });
 * }
 * ```
 */
export function useResource<E, A>(resource: Resource<E, A>): UseResourceResult<E, A> {
	const [state, setState] = useState<RemoteData<E, A>>(RemoteData.make.notAsked());
	// The resource is frozen at mount: re-acquiring on identity churn would replay the
	// acquisition; a changed asset is a remount concern (`key`).
	const epochRef = useRef(0);

	useEffect(() => {
		const epoch = ++epochRef.current;
		const controller = new AbortController();
		const scope = Resource.Scope.make();
		setState(() => RemoteData.make.loading());
		void Deferred.to.Promise(Resource.acquire(resource, scope, { signal: controller.signal })).then((result) => {
			// A discarded mount's acquisition (StrictMode's aborted first run) settles after a
			// newer mount has taken over — its result is dropped here.
			if (epochRef.current === epoch) {
				setState(
					Result.matchValue(result, {
						ok: (value) => RemoteData.make.success(value),
						err: (error) => RemoteData.make.failure(error),
					}),
				);
			}
		});
		return () => {
			controller.abort();
			scope.dispose();
		};
		// Acquisition runs once per mount; the resource is frozen at mount.
	}, []);

	return { state };
}
