import { Machine } from "@pplnd/core";
import { act, render, renderHook } from "@testing-library/react";
import { StrictMode, useEffect, useRef } from "react";
import { expect, test } from "vitest";
import { useMachine } from "../useMachine.ts";

function Child({ onMount }: { readonly onMount: () => void; }) {
	// Child effects run before parent effects — this fires before the actor exists. The ref
	// guard keeps it a mount-only effect: a fresh inline `onMount` closure per render would
	// otherwise re-fire the event on every parent re-render.
	const fired = useRef(false);
	useEffect(() => {
		if (!fired.current) {
			fired.current = true;
			onMount();
		}
	}, [onMount]);
	return <span>child</span>;
}

type CountingEvents = { readonly BUMP: void; readonly HALT: void; };

const countingMachine = Machine.make<
	Machine.State<"counting", { readonly n: number; }> | Machine.State<"halted">,
	CountingEvents
>({
	counting: {
		on: {
			BUMP: ({ value }) => Machine.state("counting", { n: value.n + 1 }),
			HALT: () => Machine.state("halted"),
		},
	},
	halted: { on: {} },
});

test("useMachine: starts in the initial state and transitions re-render", () => {
	const { result } = renderHook(() => useMachine(countingMachine, { initial: Machine.state("counting", { n: 1 }) }));
	expect(result.current.state.kind).toBe("counting");

	act(() => {
		result.current.send({ kind: "BUMP", value: undefined });
	});
	expect(result.current.state.kind).toBe("counting");
	expect(result.current.state.kind).toBe("counting");
	expect(result.current.state.kind === "counting" ? result.current.state.value.n : null).toBe(2);
});

test("useMachine: unhandled events return the current state unchanged", () => {
	const { result } = renderHook(() => useMachine(countingMachine, { initial: Machine.state("counting", { n: 1 }) }));
	act(() => {
		result.current.send({ kind: "HALT", value: undefined });
	});
	expect(result.current.state.kind).toBe("halted");

	let afterUnhandled: ReturnType<typeof result.current.send> | undefined;
	act(() => {
		afterUnhandled = result.current.send({ kind: "BUMP", value: undefined });
	});
	expect(result.current.state.kind).toBe("halted");
	expect(afterUnhandled?.kind).toBe("halted");
});

test("useMachine: queues events sent before the actor starts (child-effect ordering)", () => {
	let observed: string = "";
	function Panel() {
		const { state, send } = useMachine(countingMachine, { initial: Machine.state("counting", { n: 1 }) });
		observed = state.kind === "counting" ? String(state.value.n) : state.kind;
		return <Child onMount={() => send({ kind: "BUMP", value: undefined })} />;
	}
	render(<Panel />);
	expect(observed).toBe("2");
});

test("useMachine: abort on unmount runs exit cleanup exactly once per mount", () => {
	const exits: number[] = [];
	const exitingMachine = Machine.make<Machine.State<"counting"> | Machine.State<"halted">, CountingEvents>({
		counting: {
			on: { HALT: () => Machine.state("halted") },
			exit: () => {
				exits.push(1);
			},
		},
		halted: { on: {} },
	});
	const { unmount } = renderHook(() => useMachine(exitingMachine, { initial: Machine.state("counting") }));
	expect(exits).toHaveLength(0);
	unmount();
	expect(exits).toHaveLength(1);
});

test("useMachine: StrictMode pairs entry/exit per mount and the surviving actor responds", () => {
	const entries: number[] = [];
	const exits: number[] = [];
	const lifecycleMachine = Machine.make<
		Machine.State<"counting", { readonly n: number; }> | Machine.State<"halted">,
		CountingEvents
	>({
		halted: { on: {} },
		counting: {
			entry: ({ value }) => {
				entries.push(value.n);
			},
			exit: () => {
				exits.push(1);
			},
			on: { BUMP: ({ value }) => Machine.state("counting", { n: value.n + 1 }) },
		},
	});
	function Panel() {
		const { state, send } = useMachine(lifecycleMachine, { initial: Machine.state("counting", { n: 1 }) });
		return (
			<button onClick={() => send({ kind: "BUMP", value: undefined })} type="button">
				{state.kind === "counting" ? state.value.n : "halted"}
			</button>
		);
	}
	const { unmount } = render(
		<StrictMode>
			<Panel />
		</StrictMode>,
	);

	expect(entries).toHaveLength(2);
	// Only the StrictMode-discarded first actor has been aborted at mount time.
	expect(exits).toHaveLength(1);
	expect(entries[1]).toBe(1);

	const button = document.querySelector("button");
	expect(button?.textContent).toBe("1");

	unmount();
	// The surviving actor's exit cleanup runs on unmount — every entry is paired by an exit.
	expect(exits).toHaveLength(2);
});

test("useMachine: send is a stable identity across re-renders", () => {
	const { result, rerender } = renderHook(() =>
		useMachine(countingMachine, { initial: Machine.state("counting", { n: 1 }) })
	);
	const { send } = result.current;
	rerender();
	expect(result.current.send).toBe(send);
});
