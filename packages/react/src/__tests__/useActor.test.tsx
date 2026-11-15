import { Machine } from "@pplnd/core";
import { act, render, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { expect, test } from "vitest";
import { useActor } from "../useActor.ts";

type BuildState =
	| Machine.State<
		"editing",
		{ readonly build: { readonly cpu: string; readonly psu: string; }; readonly total: number; }
	>
	| Machine.State<"ready", { readonly build: { readonly cpu: string; readonly psu: string; }; readonly total: number; }>;

type BuildEvents = {
	readonly SET_CPU: { readonly cpu: string; };
	readonly SET_PSU: { readonly psu: string; };
	readonly SUBMIT: void;
};

function buildActor() {
	const machine = Machine.make<BuildState, BuildEvents>({
		editing: {
			on: {
				SET_CPU: ({ value }, { cpu }) => Machine.state("editing", { ...value, build: { ...value.build, cpu } }),
				SET_PSU: ({ value }, { psu }) => Machine.state("editing", { ...value, build: { ...value.build, psu } }),
				SUBMIT: ({ value }) => Machine.state("ready", value),
			},
		},
		ready: { on: {} },
	});
	return Machine.interpret(machine, {
		initial: Machine.state("editing", { build: { cpu: "amd", psu: "650w" }, total: 100 }),
	});
}

test("useActor: subscribes to the whole state and re-renders on transitions", () => {
	const actor = buildActor();
	const { result } = renderHook(() => useActor(actor));
	expect(result.current.state.kind).toBe("editing");

	act(() => {
		actor.send({ kind: "SET_PSU", value: { psu: "850w" } });
	});
	expect("build" in result.current.state.value ? result.current.state.value.build.psu : null).toBe("850w");
});

test("useActor: projects a slice and skips re-renders for untouched slices", () => {
	const actor = buildActor();
	let renders = 0;
	const { result } = renderHook(() => {
		renders += 1;
		return useActor(actor, (s) => ("build" in s.value ? s.value.build.cpu : null));
	});
	expect(result.current.state).toBe("amd");
	const rendersAtStart = renders;

	// Touching a different slice: the projected value keeps its reference, no re-render.
	act(() => {
		actor.send({ kind: "SET_PSU", value: { psu: "850w" } });
	});
	expect(renders).toBe(rendersAtStart);
	expect(result.current.state).toBe("amd");

	// Touching the projected slice: reference changes, the component re-renders.
	act(() => {
		actor.send({ kind: "SET_CPU", value: { cpu: "intel" } });
	});
	expect(renders).toBe(rendersAtStart + 1);
	expect(result.current.state).toBe("intel");
});

test("useActor: custom equality keeps the slice stable across value-semantic changes", () => {
	const actor = buildActor();
	const { result } = renderHook(() =>
		useActor(
			actor,
			(s) => ("build" in s.value ? s.value.build.cpu : null),
			(a, b) => (a ?? "").length === (b ?? "").length,
		)
	);
	expect(result.current.state).toBe("amd");

	act(() => {
		actor.send({ kind: "SET_CPU", value: { cpu: "int" } });
	});
	// Same length → equal per the custom equality → no re-render, previous reference kept.
	expect(result.current.state).toBe("amd");

	act(() => {
		actor.send({ kind: "SET_CPU", value: { cpu: "ryzen" } });
	});
	expect(result.current.state).toBe("ryzen");
});

test("useActor: does not abort the externally-owned actor on unmount", () => {
	const actor = buildActor();
	const { unmount, result } = renderHook(() => useActor(actor, (s) => ("build" in s.value ? s.value.build.cpu : null)));
	unmount();
	act(() => {
		actor.send({ kind: "SET_CPU", value: { cpu: "intel" } });
	});
	expect(actor.getState().kind).toBe("editing");
	expect("build" in actor.getState().value ? actor.getState().value.build.cpu : null).toBe("intel");
	expect(result.current.state).toBe("amd");
});

test("useActor: send is a stable pass-through to the actor", () => {
	const actor = buildActor();
	const { result } = renderHook(() => useActor(actor));
	expect(result.current.send).toBe(actor.send);
	act(() => {
		result.current.send({ kind: "SUBMIT", value: undefined });
	});
	expect(actor.getState().kind).toBe("ready");
});

test("useActor: StrictMode double mount keeps the shared actor untouched and delivers updates", () => {
	const actor = buildActor();
	let observed: string | null = null;
	function Section() {
		const { state } = useActor(actor, (s) => ("build" in s.value ? s.value.build.cpu : null));
		observed = state;
		return null;
	}
	render(
		<StrictMode>
			<Section />
		</StrictMode>,
	);
	expect(observed).toBe("amd");

	act(() => {
		actor.send({ kind: "SET_CPU", value: { cpu: "intel" } });
	});
	expect(observed).toBe("intel");
	expect(actor.getState().kind).toBe("editing");
});
