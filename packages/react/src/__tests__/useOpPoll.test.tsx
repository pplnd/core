import { Deferred, Duration, Op, Result, type Task } from "@pplnd/core";
import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useOp } from "../useOp.ts";
import { useOpPoll } from "../useOpPoll.ts";

function deferredLoad() {
	let settle!: (result: Result<string, number>) => void;
	const task: Task.Result<string, number> = () =>
		Deferred.from.Promise(
			new Promise<Result<string, number>>((resolve) => {
				settle = resolve;
			}),
		);
	return { task, resolve: (value: number) => settle(Result.make.ok(value)) };
}

function countingLoad() {
	let invocations = 0;
	const task: Task.Result<string, number> = () => {
		invocations += 1;
		return Deferred.from.Promise(new Promise<Result<string, number>>(() => {}));
	};
	return { task, count: () => invocations };
}

function managerUnderTest() {
	const load = countingLoad();
	const op = Op.make((_id: string) => load.task);
	return { load, manager: Op.interpret(op, { strategy: "restartable" }) };
}

test("useOpPoll: runs immediately on mount, repeats on the interval, and stops on unmount", () => {
	vi.useFakeTimers();
	const { manager, load } = managerUnderTest();
	const { unmount } = renderHook(() => useOpPoll(manager, { every: Duration.milliseconds(50) }, "u_1"));
	expect(load.count()).toBe(1);

	vi.advanceTimersByTime(50);
	expect(load.count()).toBe(2);
	vi.advanceTimersByTime(100);
	expect(load.count()).toBe(4);

	unmount();
	vi.advanceTimersByTime(500);
	expect(load.count()).toBe(4);

	vi.useRealTimers();
});

test("useOpPoll: re-polls with a fresh schedule when the interval changes", () => {
	vi.useFakeTimers();
	const { manager, load } = managerUnderTest();
	const { rerender } = renderHook(({ every }: { readonly every: Duration; }) => useOpPoll(manager, { every }, "u_1"), {
		initialProps: { every: Duration.milliseconds(100) },
	});
	expect(load.count()).toBe(1);

	vi.advanceTimersByTime(100);
	expect(load.count()).toBe(2);

	rerender({ every: Duration.milliseconds(25) });
	expect(load.count()).toBe(3);
	vi.advanceTimersByTime(25);
	expect(load.count()).toBe(4);
	vi.advanceTimersByTime(25);
	expect(load.count()).toBe(5);

	vi.useRealTimers();
});

test("useOpPoll: re-polls when the run arguments change", () => {
	vi.useFakeTimers();
	const { manager, load } = managerUnderTest();
	const { rerender } = renderHook(
		({ id }: { readonly id: string; }) => useOpPoll(manager, { every: Duration.milliseconds(100) }, id),
		{ initialProps: { id: "a" } },
	);
	expect(load.count()).toBe(1);

	rerender({ id: "b" });
	expect(load.count()).toBe(2);

	vi.advanceTimersByTime(100);
	expect(load.count()).toBe(3);

	vi.useRealTimers();
});

test("useOpPoll: composes with useOp — polled runs drive the state union", async () => {
	const load = deferredLoad();
	const op = Op.make((_id: string) => load.task);
	const manager = Op.interpret(op, { strategy: "restartable" });
	const { result } = renderHook(() => {
		useOpPoll(manager, { every: Duration.hours(1) }, "u_1");
		return useOp(manager);
	});
	expect(result.current.state.kind).toBe("Pending");

	await act(async () => {
		load.resolve(42);
		await Promise.resolve();
	});
	expect(Op.Outcome.is.ok(result.current.state)).toBe(true);
});
