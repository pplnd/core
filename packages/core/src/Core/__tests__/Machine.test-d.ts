import { expectTypeOf, test } from "vitest";
import { pipe } from "../../Composition/pipe.ts";
import { EventBus } from "../EventBus.ts";
import { Machine } from "../Machine.ts";

// =============================================================================
// Test Domain Types
// =============================================================================

type AuthState =
	| Machine.State<"loggedOut", void, "authenticating">
	| Machine.State<"authenticating", { readonly email: string; }, "authenticated" | "failed">
	| Machine.State<"authenticated", { readonly token: string; }, "loggedOut">
	| Machine.State<"failed", { readonly error: string; }, "authenticating" | "loggedOut">;

declare const getAuthState: () => AuthState;

type AuthEvents = {
	SUBMIT: { readonly email: string; };
	RESOLVE: { readonly token: string; };
	REJECT: { readonly error: string; };
	LOGOUT: void;
};

// =============================================================================
// 1. State Construction & Contravariant Assignability
// =============================================================================

test("state: constructs states that assign cleanly to constrained unions with zero casts", () => {
	const loggedOut = Machine.state("loggedOut");
	const authenticating = Machine.state("authenticating", { email: "dev@example.com" });

	expectTypeOf(loggedOut).toEqualTypeOf<Machine.State<"loggedOut", void, string>>();
	expectTypeOf(authenticating).toEqualTypeOf<Machine.State<"authenticating", { email: string; }, string>>();

	// Positive bounds: assign directly to union variants without type assertions
	const _state1: AuthState = loggedOut;
	const _state2: AuthState = authenticating;
	expectTypeOf(_state1).toBeObject();
	expectTypeOf(_state2).toBeObject();

	// @ts-expect-error — cannot assign state with incorrect payload type
	const _badPayload: AuthState = Machine.state("authenticating", { email: 123 });
	expectTypeOf(_badPayload).toBeObject();

	// @ts-expect-error — cannot assign unknown state kind to domain union
	const _unknownKind: AuthState = Machine.state("nonexistent");
	expectTypeOf(_unknownKind).toBeObject();
});

// =============================================================================
// 2. Machine.make & Compile-Time Outbound Transition Constraints
// =============================================================================

test("make: validates transition table and enforces AllowedTargets at compile time", () => {
	const validMachine = Machine.make<AuthState, AuthEvents>({
		loggedOut: { on: { SUBMIT: (_state, { email }) => Machine.state("authenticating", { email }) } },
		authenticating: {
			on: {
				RESOLVE: (_state, { token }) => Machine.state("authenticated", { token }),
				REJECT: (_state, { error }) => Machine.state("failed", { error }),
			},
		},
		authenticated: { on: { LOGOUT: () => Machine.state("loggedOut") } },
		failed: {
			on: {
				SUBMIT: (_state, { email }) => Machine.state("authenticating", { email }),
				LOGOUT: () => Machine.state("loggedOut"),
			},
		},
	});

	expectTypeOf(validMachine).toEqualTypeOf<Machine<AuthState, AuthEvents>>();
	expectTypeOf(validMachine[Symbol.toStringTag]).toEqualTypeOf<string | undefined>();

	// @ts-expect-error — machine definitions do not have an ID
	expectTypeOf(validMachine.id).toBeString();

	Machine.make<AuthState, AuthEvents>({
		loggedOut: {
			on: {
				// @ts-expect-error — illegal outbound target: "loggedOut" cannot transition directly to "authenticated"
				SUBMIT: () => Machine.state("authenticated", { token: "bypass" }),
			},
		},
		authenticating: {},
		authenticated: {},
		failed: {},
	});

	// @ts-expect-error — missing state configuration: "failed" state omitted from states table
	Machine.make<AuthState, AuthEvents>({ loggedOut: {}, authenticating: {}, authenticated: {} });
});

// =============================================================================
// 3. Machine.is Type Guard Narrowing
// =============================================================================

test("is: refines state union down to the specific variant", () => {
	const state = getAuthState();

	if (Machine.is("authenticating")(state)) {
		expectTypeOf(state).toEqualTypeOf<
			Machine.State<"authenticating", { readonly email: string; }, "authenticated" | "failed">
		>();
		expectTypeOf(state.value.email).toEqualTypeOf<string>();
	} else {
		expectTypeOf(state).toEqualTypeOf<
			| Machine.State<"loggedOut", void, "authenticating">
			| Machine.State<"authenticated", { readonly token: string; }, "loggedOut">
			| Machine.State<"failed", { readonly error: string; }, "authenticating" | "loggedOut">
		>();
	}
});

// =============================================================================
// 4. Machine.match Exhaustive Pattern Matching
// =============================================================================

test("match: enforces exhaustive branch coverage and infers return type", () => {
	const state = getAuthState();

	const matcher = Machine.match<AuthState, string>({
		loggedOut: () => "logged-out",
		authenticating: (s) => s.value.email,
		authenticated: (s) => s.value.token,
		failed: (s) => s.value.error,
	});

	expectTypeOf(matcher(state)).toEqualTypeOf<string>();

	// @ts-expect-error — missing "failed" branch in match cases
	Machine.match<AuthState, string>({ loggedOut: () => "out", authenticating: () => "auth", authenticated: () => "ok" });
});

test("match: data-first form infers heterogeneous branch returns", () => {
	const state = getAuthState();
	const result = Machine.match(state, {
		loggedOut: () => null,
		authenticating: (s) => s.value.email,
		authenticated: (s) => s.value.token,
		failed: (s) => s.value.error,
	});
	expectTypeOf(result).toEqualTypeOf<string | null>();
});

// =============================================================================
// 5. Machine.transition & Actor.send Event Verification
// =============================================================================

test("transition & actor: validate event types and enforce strict payloads", () => {
	const machine = Machine.make<AuthState, AuthEvents>({
		loggedOut: {},
		authenticating: {},
		authenticated: {},
		failed: {},
	});

	const actor = Machine.interpret(machine, { initial: Machine.state("loggedOut") });

	expectTypeOf(actor.id).toEqualTypeOf<string | undefined>();
	expectTypeOf(actor[Symbol.toStringTag]).toEqualTypeOf<string | undefined>();

	const actorWithOpts = Machine.interpret(machine, { initial: Machine.state("loggedOut"), id: "auth-actor" });
	expectTypeOf(actorWithOpts.id).toEqualTypeOf<string | undefined>();
	// @ts-expect-error — callback errors are handled by callbacks, not an actor option
	Machine.interpret(machine, { initial: Machine.state("loggedOut"), onError: () => {} });

	expectTypeOf(actor.getState()).toEqualTypeOf<AuthState>();
	expectTypeOf(actor.send({ kind: "LOGOUT" })).toEqualTypeOf<AuthState>();
	expectTypeOf(actor.send({ kind: "SUBMIT", value: { email: "dev@example.com" } })).toEqualTypeOf<AuthState>();

	// @ts-expect-error — unlisted event kind rejected
	actor.send({ kind: "UNKNOWN_EVENT" });

	// @ts-expect-error — invalid payload for SUBMIT (number instead of string)
	actor.send({ kind: "SUBMIT", value: { email: 123 } });

	// @ts-expect-error — unlisted event kind rejected in transition
	Machine.transition(machine, { kind: "UNKNOWN_EVENT" });
});

// =============================================================================
// 6. Synergy with EventBus
// =============================================================================

test("interpret: enforces EventBus schema compatibility", () => {
	const machine = Machine.make<AuthState, AuthEvents>({
		loggedOut: {},
		authenticating: {},
		authenticated: {},
		failed: {},
	});

	const compatibleBus = EventBus.make<AuthEvents>();
	const incompatibleBus = EventBus.make<{ OTHER: { count: number; }; }>();

	expectTypeOf(Machine.interpret(machine, { initial: Machine.state("loggedOut"), bus: compatibleBus })).toEqualTypeOf<
		Machine.Actor<AuthState, AuthEvents>
	>();

	// @ts-expect-error — incompatible event bus schema
	Machine.interpret(machine, { initial: Machine.state("loggedOut"), bus: incompatibleBus });
});

// =============================================================================
// 7. Machine.to.reducer Type Verification
// =============================================================================

test("to.reducer: produces an uncurried reducer typed for React", () => {
	const machine = Machine.make<AuthState, AuthEvents>({
		loggedOut: {},
		authenticating: {},
		authenticated: {},
		failed: {},
	});

	const reducer = Machine.to.reducer(machine);

	expectTypeOf(reducer).toEqualTypeOf<(state: AuthState, event: Machine.EventMessage<AuthEvents>) => AuthState>();

	const next = reducer(getAuthState(), { kind: "LOGOUT" });
	expectTypeOf(next).toEqualTypeOf<AuthState>();

	// @ts-expect-error — unlisted event rejected in reducer
	reducer(getAuthState(), { kind: "UNKNOWN_ACTION" });

	// @ts-expect-error — invalid payload rejected in reducer
	reducer(undefined, { kind: "SUBMIT", value: { email: 123 } });
});

// =============================================================================
// 8. Regression Suite
// =============================================================================

test("interpret: accepts shared subset EventBus, superset EventBus, and Machine.InterpretOptions<States, Events>", () => {
	const machine = Machine.make<AuthState, AuthEvents>({
		loggedOut: {},
		authenticating: {},
		authenticated: {},
		failed: {},
	});

	const subsetBus = EventBus.make<{ LOGOUT: void; }>();
	const supersetBus = EventBus.make<AuthEvents & { PAGE_VIEW: { readonly url: string; }; }>();

	expectTypeOf(Machine.interpret(machine, { initial: Machine.state("loggedOut"), bus: subsetBus })).toEqualTypeOf<
		Machine.Actor<AuthState, AuthEvents>
	>();
	expectTypeOf(Machine.interpret(machine, { initial: Machine.state("loggedOut"), bus: supersetBus })).toEqualTypeOf<
		Machine.Actor<AuthState, AuthEvents>
	>();
	const incompatibleBus = EventBus.make<{ SUBMIT: { email: number; }; }>();
	const unrelatedBus = EventBus.make<{ OTHER: void; }>();
	// @ts-expect-error — shared events must have compatible payloads
	expectTypeOf(Machine.interpret(machine, { initial: Machine.state("loggedOut"), bus: incompatibleBus })).toBeObject();
	// @ts-expect-error — a bus must share an event with the machine
	expectTypeOf(Machine.interpret(machine, { initial: Machine.state("loggedOut"), bus: unrelatedBus })).toBeObject();

	const options: Machine.InterpretOptions<AuthState, AuthEvents> = {
		initial: Machine.state("loggedOut"),
		id: "auth-actor",
	};
	expectTypeOf(Machine.interpret(machine, { ...options, initial: Machine.state("loggedOut") })).toEqualTypeOf<
		Machine.Actor<AuthState, AuthEvents>
	>();

	type OptionalPayloadEvents = { RESET: { readonly reason?: string; } | undefined; };
	const optionalMsg: Machine.EventMessage<OptionalPayloadEvents> = { kind: "RESET" };
	expectTypeOf(optionalMsg).toMatchTypeOf<Machine.EventMessage<OptionalPayloadEvents>>();
});

type PaymentState =
	| Machine.State<"paying", { readonly session: string; }>
	| Machine.State<"fault", { readonly fault: string; }>;
type PaymentEvents = {
	readonly CARD_INSERTED: void;
	readonly PAYMENT_APPROVED: { readonly session: string; };
	readonly TERMINAL_FAULT: { readonly fault: string; };
};
type CheckoutState = Machine.State<"checkout", { readonly authorized: boolean; }>;

const paymentBase = Machine.make<Machine.State<"selecting"> | Machine.State<"halted">, { readonly RESET: void; }>({
	selecting: { on: { RESET: () => Machine.state("halted") } },
	halted: { on: {} },
});

const withPayment = <States extends { readonly kind: string; }, Events extends { readonly RESET: void; }>(
	machine: Machine<States, Events>,
): Machine<States | PaymentState, Events & PaymentEvents> =>
	Machine.merge(
		machine,
		Machine.fragment<PaymentState, PaymentEvents & { readonly RESET: void; }>({
			selecting: { on: { CARD_INSERTED: () => Machine.state("paying", { session: "t-1" }) } },
			paying: { on: { PAYMENT_APPROVED: () => Machine.state("paying", { session: "approved" }) } },
			fault: { on: { RESET: () => Machine.state("halted") } },
		}),
	);

const withCheckout = <
	States extends { readonly kind: string; },
	Events extends { readonly PAYMENT_APPROVED: { readonly session: string; }; },
>(machine: Machine<States, Events>): Machine<States | CheckoutState, Events & { readonly CHECKOUT_DONE: void; }> =>
	Machine.merge(
		machine,
		Machine.fragment<CheckoutState, Events & { readonly CHECKOUT_DONE: void; }>({
			paying: { on: { CHECKOUT_DONE: () => Machine.state("checkout", { authorized: true }) } },
			checkout: { on: {} },
		}),
	);

test("blocks: the composed pipe typechecks and the send surface widens", () => {
	const composed = pipe(paymentBase, withPayment, withCheckout);
	const actor = Machine.interpret(composed, { initial: Machine.state("selecting") });
	const next = actor.send({ kind: "CARD_INSERTED", value: undefined });
	expectTypeOf(next.kind).toEqualTypeOf<"selecting" | "halted" | "paying" | "fault" | "checkout">();
});

test("blocks: the contract chain fails when a prior step is omitted", () => {
	expectTypeOf(pipe(paymentBase, withPayment, withCheckout)).not.toBeNever();

	// @ts-expect-error omitting withPayment breaks withCheckout's PAYMENT_APPROVED requirement
	pipe(paymentBase, withCheckout);
});

test("blocks: sending an event no step provides is rejected", () => {
	const composed = pipe(paymentBase, withPayment, withCheckout);
	const actor = Machine.interpret(composed, { initial: Machine.state("selecting") });
	actor.send({ kind: "CARD_INSERTED", value: undefined });
	// @ts-expect-error an event no step provides is not in the send surface
	actor.send({ kind: "REFUND", value: undefined });
});

test("blocks: fragment handler payloads are typed from the declared events", () => {
	Machine.fragment<
		Machine.State<"paying", { readonly session: string; }>,
		{ readonly PAYMENT_APPROVED: { readonly session: string; }; }
	>({
		paying: {
			on: {
				PAYMENT_APPROVED: (state, payload) => {
					expectTypeOf(payload.session).toEqualTypeOf<string>();
					expectTypeOf(state.kind).toEqualTypeOf<"paying">();
					return Machine.state("paying", { session: payload.session });
				},
			},
		},
	});
});

test("blocks: fragment payloads are checked against the declared events", () => {
	Machine.fragment<
		Machine.State<"paying", { readonly session: string; }>,
		{ readonly PAYMENT_APPROVED: { readonly session: string; }; }
	>({
		paying: {
			on: {
				// @ts-expect-error the handler payload must match the declared event's payload type
				PAYMENT_APPROVED: (_state, payload: { readonly wrong: true; }) => {
					void payload;
					return Machine.state("paying", { session: "" });
				},
			},
		},
	});
});
