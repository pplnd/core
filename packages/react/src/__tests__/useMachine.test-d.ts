import { Machine } from "@pplnd/core";
import { expectTypeOf, test } from "vitest";
import { useMachine, type UseMachineResult } from "../useMachine.ts";

type PanelState = Machine.State<"idle"> | Machine.State<"authorized", { readonly token: string; }>;

type PanelEvents = { readonly SUBMIT: void; };

declare const machine: Machine<PanelState, PanelEvents>;

test("useMachine: the bound state is the machine's variant union with guaranteed payloads", () => {
	const bound = useMachine(machine, { initial: Machine.state("idle") });
	expectTypeOf(bound).toEqualTypeOf<UseMachineResult<PanelState, PanelEvents>>();
	expectTypeOf(bound.state).toEqualTypeOf<PanelState>();
	expectTypeOf(bound.send).toEqualTypeOf<(event: Machine.EventMessage<PanelEvents>) => PanelState>();
});

test("useMachine: initial state participates in the States union", () => {
	expectTypeOf(useMachine(machine, { initial: Machine.state("authorized", { token: "t" }) }).state).toEqualTypeOf<
		PanelState
	>();
});

test("useMachine: rejects unknown events and non-machine definitions", () => {
	expectTypeOf(useMachine(machine, { initial: Machine.state("idle") }).state).toEqualTypeOf<PanelState>();
	const { send } = useMachine(machine, { initial: Machine.state("idle") });
	// @ts-expect-error an unknown event kind is rejected
	send({ kind: "REFUND", value: undefined });
	// @ts-expect-error the initial state must be a machine state of this machine
	useMachine(machine, { initial: "idle" });
});
