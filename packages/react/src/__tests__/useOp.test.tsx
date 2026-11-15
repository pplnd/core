import { Deferred, Op, Result, type Task } from "@pplnd/core";
import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { useOp } from "../useOp.ts";

type LoadError = string;

function deferredLoad() {
	let settle!: (result: Result<LoadError, number>) => void;
	const task: Task.Result<LoadError, number> = () =>
		Deferred.from.Promise(
			new Promise<Result<LoadError, number>>((resolve) => {
				settle = resolve;
			}),
		);
	return {
		task,
		resolve: (value: number) => settle(Result.make.ok(value)),
		reject: (error: LoadError) => settle(Result.make.err(error)),
	};
}

function okValue(state: Op.State<LoadError, number>): number | null {
	return Op.is.settled(state)
		? Op.Outcome.matchValue(state, { ok: (value) => value, err: () => null, nil: () => null })
		: null;
}

function errValue(state: Op.State<LoadError, number>): LoadError | null {
	return Op.is.settled(state)
		? Op.Outcome.matchValue(state, { ok: () => null, err: (error) => error, nil: () => null })
		: null;
}

function nilReason(state: Op.State<LoadError, number>): string | null {
	return Op.is.settled(state)
		? Op.Outcome.matchValue(state, { ok: () => null, err: () => null, nil: (reason) => reason })
		: null;
}

function queuedPosition(state: Op.State<LoadError, number>): number | null {
	return Op.is.queued(state) ? state.position : null;
}

function managerUnderTest() {
	const load = deferredLoad();
	const op = Op.make((_id: string) => load.task);
	return { load, manager: Op.interpret(op, { strategy: "once" }) };
}

function queuedManagerUnderTest() {
	const load = deferredLoad();
	const op = Op.make((_id: string) => load.task);
	return { load, manager: Op.interpret(op, { strategy: "queue" }) };
}

test("useOp: starts Idle and re-renders through Pending to the Ok outcome", async () => {
	const { manager, load } = managerUnderTest();
	const { result } = renderHook(() => useOp(manager));
	expect(result.current.state.kind).toBe("Idle");

	let settled: unknown;
	act(() => {
		settled = result.current.run("u_1");
	});
	expect(result.current.state.kind).toBe("Pending");

	await act(async () => {
		load.resolve(42);
		await Promise.resolve();
	});
	expect(result.current.state.kind).toBe("OpOk");
	expect(okValue(result.current.state)).toBe(42);
	expect(settled).toBeDefined();
});

test("useOp: settles Err with the task error", async () => {
	const { manager, load } = managerUnderTest();
	const { result } = renderHook(() => useOp(manager));
	act(() => {
		void result.current.run("u_1");
	});
	await act(async () => {
		load.reject("offline");
		await Promise.resolve();
	});
	expect(errValue(result.current.state)).toBe("offline");
});

test("useOp: forwards abort and settles the state as Nil aborted", () => {
	const { manager, load } = managerUnderTest();
	const { result } = renderHook(() => useOp(manager));
	act(() => {
		void result.current.run("u_1");
	});
	expect(result.current.state.kind).toBe("Pending");

	act(() => {
		result.current.abort();
		load.resolve(1);
	});
	expect(nilReason(result.current.state)).toBe("aborted");
});

test("useOp: forwards reset back to Idle", async () => {
	const { manager, load } = managerUnderTest();
	const { result } = renderHook(() => useOp(manager));
	await act(async () => {
		void result.current.run("u_1");
		load.resolve(1);
		await Promise.resolve();
	});
	expect(Op.Outcome.is.ok(result.current.state)).toBe(true);

	act(() => {
		result.current.reset();
	});
	expect(result.current.state.kind).toBe("Idle");
});

test("useOp: exposes stable run/abort/reset identities across re-renders", () => {
	const { manager } = managerUnderTest();
	const { result, rerender } = renderHook(() => useOp(manager));
	const { run, abort, reset } = result.current;

	rerender();
	expect(result.current.run).toBe(run);
	expect(result.current.abort).toBe(abort);
	expect(result.current.reset).toBe(reset);
});

test("useOp: unsubscribes on unmount", () => {
	const { manager, load } = managerUnderTest();
	let renders = 0;
	const { result, unmount, rerender } = renderHook(() => {
		renders += 1;
		return useOp(manager);
	});
	rerender();
	const rendersAtUnmount = renders;
	unmount();

	act(() => {
		void result.current.run("u_1");
		load.resolve(1);
	});
	expect(renders).toBe(rendersAtUnmount);
});

test("useOp: renders Queued with its position under a queue strategy", async () => {
	const { manager, load } = queuedManagerUnderTest();
	const { result } = renderHook(() => useOp(manager));
	act(() => {
		void result.current.run("a");
	});
	expect(result.current.state.kind).toBe("Pending");

	act(() => {
		void result.current.run("b");
	});
	expect(queuedPosition(result.current.state)).toBe(0);

	await act(async () => {
		load.resolve(1);
		await Promise.resolve();
	});
	expect(result.current.state.kind).toBe("Pending");

	await act(async () => {
		load.resolve(2);
		await Promise.resolve();
	});
	expect(okValue(result.current.state)).toBe(2);
});
