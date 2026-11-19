import { Machine } from "@pplnd/core";
import { expectTypeOf, test } from "vitest";
import { useActor, type UseActorResult } from "../useActor.ts";

type PanelState = Machine.State<"idle"> | Machine.State<"authorized", { readonly token: string; }>;

type PanelEvents = { readonly SUBMIT: void; readonly APPROVED: { readonly token: string; }; };

declare const actor: Machine.Actor<PanelState, PanelEvents>;

test("useActor: whole-state overload binds the variant union", () => {
	const bound = useActor(actor);
	expectTypeOf(bound).toEqualTypeOf<UseActorResult<PanelState, PanelEvents, PanelState>>();
	expectTypeOf(bound.state).toEqualTypeOf<PanelState>();
	expectTypeOf(bound.send).toEqualTypeOf<(event: Machine.EventMessage<PanelEvents>) => PanelState>();
});

test("useActor: selector overload projects the slice type", () => {
	const bound = useActor(actor, (s) => (s.kind === "authorized" ? s.value.token : null));
	expectTypeOf(bound).toEqualTypeOf<UseActorResult<PanelState, PanelEvents, string | null>>();
	expectTypeOf(bound.state).toEqualTypeOf<string | null>();
});

test("useActor: custom equality keeps the slice type", () => {
	const bound = useActor(actor, (s) => s.kind, () => true);
	expectTypeOf(bound.state).toEqualTypeOf<PanelState["kind"]>();
});

test("useActor: rejects selectors returning values inconsistent with usage and invalid events", () => {
	const { send, state } = useActor(actor, (s) => s.kind);
	expectTypeOf(state).toEqualTypeOf<PanelState["kind"]>();
	// @ts-expect-error an unknown event kind is rejected
	send({ kind: "REFUND", value: undefined });
	// @ts-expect-error the selector must accept the machine's state union
	useActor(actor, (s: { readonly alien: true; }) => s.alien);
});
