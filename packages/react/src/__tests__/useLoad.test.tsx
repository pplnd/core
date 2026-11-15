import { Deferred, RemoteData, Result, type Task } from "@pplnd/core";
import { act, render, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { expect, test } from "vitest";
import { useLoad } from "../useLoad.ts";

type LoadError = string;

/**
 * A manually settled `Task.Result` recording every `AbortSignal` the hook hands it and every
 * per-run settle function, so tests can settle runs out of order and assert cancellation.
 */
function deferredLoad() {
	const signals: AbortSignal[] = [];
	const settles: Array<(result: Result<LoadError, number>) => void> = [];
	const task: Task.Result<LoadError, number> = (signal?: AbortSignal) => {
		if (signal !== undefined) {
			signals.push(signal);
		}
		return Deferred.from.Promise(
			new Promise<Result<LoadError, number>>((resolve) => {
				settles.push(resolve);
			}),
		);
	};
	return {
		task,
		signals,
		resolve: (value: number) => settles.at(-1)?.(Result.make.ok(value)),
		reject: (error: LoadError) => settles.at(-1)?.(Result.make.err(error)),
		resolveRun: (index: number, value: number) => settles[index]?.(Result.make.ok(value)),
	};
}

function valueOf(state: RemoteData<LoadError, number>): number | null {
	return RemoteData.matchValue(state, {
		notAsked: () => null,
		loading: () => null,
		failure: () => null,
		success: (value) => value,
	});
}

test("useLoad: starts Loading on mount and settles Success with the task value", async () => {
	const load = deferredLoad();
	const { result } = renderHook(() => useLoad(load.task));
	expect(result.current.state.kind).toBe("Loading");
	expect(load.signals).toHaveLength(1);

	await act(async () => {
		load.resolve(42);
		await Promise.resolve();
	});
	expect(result.current.state.kind).toBe("Success");
	expect(valueOf(result.current.state)).toBe(42);
});

test("useLoad: settles Failure with the task error", async () => {
	const load = deferredLoad();
	const { result } = renderHook(() => useLoad(load.task));
	await act(async () => {
		load.reject("offline");
		await Promise.resolve();
	});
	expect(
		RemoteData.matchValue(result.current.state, {
			notAsked: () => null,
			loading: () => null,
			success: () => null,
			failure: (error) => error,
		}),
	).toBe("offline");
});

test("useLoad: aborts the previous signal before the new run starts on deps change", () => {
	const load = deferredLoad();
	let previousAbortedAtStart: boolean | undefined;
	const tracking: Task.Result<LoadError, number> = (signal?: AbortSignal) => {
		previousAbortedAtStart = load.signals.at(-1)?.aborted;
		return load.task(signal);
	};
	const { rerender } = renderHook(({ id }: { readonly id: string; }) => useLoad(tracking, { deps: [id] }), {
		initialProps: { id: "a" },
	});

	rerender({ id: "b" });
	expect(load.signals).toHaveLength(2);
	expect(previousAbortedAtStart).toBe(true);
	expect(load.signals[0]?.aborted).toBe(true);
});

test("useLoad: keeps the previous Success visible while re-running (keepPrevious default)", async () => {
	const load = deferredLoad();
	const { result, rerender } = renderHook(({ id }: { readonly id: string; }) => useLoad(load.task, { deps: [id] }), {
		initialProps: { id: "a" },
	});
	await act(async () => {
		load.resolve(1);
		await Promise.resolve();
	});
	expect(valueOf(result.current.state)).toBe(1);

	rerender({ id: "b" });
	expect(result.current.state.kind).toBe("Success");

	await act(async () => {
		load.resolve(2);
		await Promise.resolve();
	});
	expect(valueOf(result.current.state)).toBe(2);
});

test("useLoad: resets to Loading on rerun with keepPrevious false", async () => {
	const load = deferredLoad();
	const { result, rerender } = renderHook(
		({ id }: { readonly id: string; }) => useLoad(load.task, { deps: [id], keepPrevious: false }),
		{ initialProps: { id: "a" } },
	);
	await act(async () => {
		load.resolve(1);
		await Promise.resolve();
	});
	expect(valueOf(result.current.state)).toBe(1);

	rerender({ id: "b" });
	expect(result.current.state.kind).toBe("Loading");

	await act(async () => {
		load.resolve(2);
		await Promise.resolve();
	});
	expect(valueOf(result.current.state)).toBe(2);
});

test("useLoad: reload re-runs the task without touching deps and keeps the previous result", async () => {
	const load = deferredLoad();
	const { result } = renderHook(() => useLoad(load.task, { deps: ["a"] }));
	await act(async () => {
		load.resolve(1);
		await Promise.resolve();
	});
	expect(valueOf(result.current.state)).toBe(1);

	act(() => {
		result.current.reload();
	});
	expect(load.signals).toHaveLength(2);
	expect(result.current.state.kind).toBe("Success");

	await act(async () => {
		load.resolve(2);
		await Promise.resolve();
	});
	expect(valueOf(result.current.state)).toBe(2);
});

test("useLoad: discards a stale run settled after a deps change", async () => {
	const load = deferredLoad();
	const { result, rerender } = renderHook(({ id }: { readonly id: string; }) => useLoad(load.task, { deps: [id] }), {
		initialProps: { id: "a" },
	});

	rerender({ id: "b" });
	await act(async () => {
		load.resolveRun(0, 1);
		await Promise.resolve();
	});
	expect(result.current.state.kind).toBe("Loading");

	await act(async () => {
		load.resolve(2);
		await Promise.resolve();
	});
	expect(valueOf(result.current.state)).toBe(2);
});

test("useLoad: StrictMode double mount aborts the first run and applies one result", async () => {
	const load = deferredLoad();
	let observed = "";
	function LoadProbe() {
		const { state } = useLoad(load.task);
		observed = `${state.kind}:${valueOf(state) ?? ""}`;
		return null;
	}
	render(
		<StrictMode>
			<LoadProbe />
		</StrictMode>,
	);

	expect(load.signals).toHaveLength(2);
	expect(load.signals[0]?.aborted).toBe(true);
	expect(load.signals[1]?.aborted).toBe(false);

	await act(async () => {
		load.resolveRun(0, 1);
		await Promise.resolve();
	});
	await act(async () => {
		load.resolve(2);
		await Promise.resolve();
	});
	expect(observed).toBe("Success:2");
});

test("useLoad: never applies a settled result after unmount", async () => {
	const load = deferredLoad();
	const { result, unmount } = renderHook(() => useLoad(load.task));
	unmount();
	await act(async () => {
		load.resolve(42);
		await Promise.resolve();
	});
	expect(result.current.state.kind).toBe("Loading");
});
