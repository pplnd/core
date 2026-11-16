import { Deferred, RemoteData, Resource, Result, Task } from "@pplnd/core";
import { act, render, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { expect, test } from "vitest";
import { useResource } from "../useResource.ts";

type LockError = string;

function deferredResource(released: string[]) {
	const settles: Array<(result: Result<LockError, string>) => void> = [];
	const resource: Resource<LockError, string> = Resource.make(
		() =>
			Deferred.from.Promise(
				new Promise<Result<LockError, string>>((resolve) => {
					settles.push(resolve);
				}),
			),
		(value) => {
			released.push(value);
			return Task.make(undefined);
		},
	);
	// Acquire tasks start on a microtask inside the scope's FIFO queue, so settling drains
	// until the requested invocation's resolver exists instead of racing a fixed hop count.
	const settle = async (index: number, value: string) => {
		while (settles.length <= index) {
			await Promise.resolve();
		}
		settles[index]?.(Result.make.ok(value));
	};
	return { resource, settle, settleCount: settles.length };
}

function failResource(released: string[], error: LockError) {
	const resource: Resource<LockError, string> = Resource.make(
		() => Deferred.from.Promise(Promise.resolve(Result.make.err(error))),
		(value) => {
			released.push(value);
			return Task.make(undefined);
		},
	);
	return { resource };
}

function valueOf(state: RemoteData<LockError, string>): string | null {
	return RemoteData.matchValue(state, {
		notAsked: () => null,
		loading: () => null,
		failure: () => null,
		success: (value) => value,
	});
}

test("useResource: starts Loading on mount and settles Success with the acquired value", async () => {
	const released: string[] = [];
	const { resource, settle } = deferredResource(released);
	const { result } = renderHook(() => useResource(resource));
	expect(result.current.state.kind).toBe("Loading");

	await act(async () => {
		await settle(0, "lock-1");
		await Promise.resolve();
	});
	expect(result.current.state.kind).toBe("Success");
	expect(valueOf(result.current.state)).toBe("lock-1");
	expect(released).toStrictEqual([]);
});

test("useResource: settles Failure with the acquisition error and releases nothing", async () => {
	const released: string[] = [];
	const { resource } = failResource(released, "lock taken");
	const { result } = renderHook(() => useResource(resource));
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
	expect(result.current.state.kind).toBe("Failure");
	expect(
		RemoteData.matchValue(result.current.state, {
			notAsked: () => null,
			loading: () => null,
			success: () => null,
			failure: (error) => error,
		}),
	).toBe("lock taken");
	expect(released).toStrictEqual([]);
});

test("useResource: unmount mid-acquisition releases the asset as soon as it settles", async () => {
	const released: string[] = [];
	const { resource, settle } = deferredResource(released);
	const { result, unmount } = renderHook(() => useResource(resource));
	unmount();

	await act(async () => {
		await settle(0, "late-lock");
		await Promise.resolve();
	});
	expect(released).toStrictEqual(["late-lock"]);
	expect(result.current.state.kind).toBe("Loading");
});

test("useResource: releases on unmount after a successful acquisition", async () => {
	const released: string[] = [];
	const { resource, settle } = deferredResource(released);
	const { result, unmount } = renderHook(() => useResource(resource));
	await act(async () => {
		await settle(0, "lock-1");
		await Promise.resolve();
	});
	expect(valueOf(result.current.state)).toBe("lock-1");

	unmount();
	expect(released).toStrictEqual(["lock-1"]);
});

test("useResource: never re-acquires on re-render", async () => {
	const released: string[] = [];
	const { resource, settle } = deferredResource(released);
	const { result, rerender } = renderHook(() => useResource(resource));
	await act(async () => {
		await settle(0, "lock-1");
		await Promise.resolve();
	});
	rerender();
	expect(valueOf(result.current.state)).toBe("lock-1");
});

test("useResource: StrictMode discards the aborted first mount and holds one asset", async () => {
	const released: string[] = [];
	const { resource, settle } = deferredResource(released);
	let observed: string = "";
	function LockProbe() {
		const { state } = useResource(resource);
		observed = `${state.kind}:${valueOf(state) ?? ""}`;
		return null;
	}
	const { unmount } = render(
		<StrictMode>
			<LockProbe />
		</StrictMode>,
	);

	// Two mounts, two acquisitions; the first scope is already disposed.
	await act(async () => {
		await settle(0, "discarded");
		await Promise.resolve();
	});
	expect(released).toStrictEqual(["discarded"]);
	expect(observed).toBe("Loading:");

	await act(async () => {
		await settle(1, "held");
		await Promise.resolve();
	});
	expect(observed).toBe("Success:held");
	expect(released).toStrictEqual(["discarded"]);

	unmount();
	expect(released).toStrictEqual(["discarded", "held"]);
});
