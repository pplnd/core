import type { WithKind, WithValue } from "../internal/InternalTypes";
import { EventBus } from "./EventBus.ts";

// =============================================================================
// Phantom Brand Symbols
// =============================================================================
declare const _targetsBrand: unique symbol;

// =============================================================================
// Types
// =============================================================================

/**
 * A named state, with an optional value and allowed destination kinds.
 *
 * `AllowedTargets` restricts transition handlers at compile time. A handler can also return its
 * current state, and an unhandled event leaves the state unchanged.
 *
 * @example
 * ```ts
 * type AuthState =
 *   | Machine.State<"loggedOut", void, "authenticating">
 *   | Machine.State<"authenticating", { readonly email: string }, "authenticated" | "failed">
 *   | Machine.State<"authenticated", { readonly token: string }, "loggedOut">
 *   | Machine.State<"failed", { readonly error: string }, "authenticating" | "loggedOut">;
 * ```
 */
type MachineState<Kind extends string, Data = void, AllowedTargets extends string = string> = [Data] extends [void]
	? WithKind<Kind> & { readonly [_targetsBrand]?: (target: AllowedTargets) => void; }
	: WithKind<Kind> & WithValue<Data> & { readonly [_targetsBrand]?: (target: AllowedTargets) => void; };

type AnyMachineState = MachineState<string, any, never>;

type TargetsOf<S> = S extends { readonly [_targetsBrand]?: (target: infer T) => void; } ? T : string;

/**
 * A discriminated union of event messages accepted by a state machine.
 *
 * Conforms to `{ kind: Key, value: Events[Key] }` (where `void` or `undefined`
 * event payloads allow `value` to be omitted), ensuring direct compatibility
 * with {@link EventBus.Message}.
 */
type MachineEventMessage<Events extends Record<string, unknown>> = {
	[K in keyof Events & string]: undefined extends Events[K] ? WithKind<K> & { readonly value?: Events[K]; }
		: [Events[K]] extends [void] ? WithKind<K> & { readonly value?: void; }
		: WithKind<K> & WithValue<Events[K]>;
}[keyof Events & string];

/**
 * Transition handler function for a specific event within a state.
 *
 * The return type is constrained to either an allowed target state (as specified by
 * the state's `AllowedTargets` generic parameter) or the current state `S` (self-transition).
 */
type MachineTransitionHandler<S extends AnyMachineState, Payload, States extends AnyMachineState> = (
	state: S,
	payload: Payload,
) => Extract<States, { readonly kind: NonNullable<TargetsOf<S>>; }> | S;

/**
 * Context provided to state entry lifecycle effects.
 */
type MachineEntryContext<Events extends Record<string, unknown>> = {
	/**
	 * Sends an event to the actor while this entry is active.
	 * Calls after leaving the state or aborting the actor are ignored. While the actor is running,
	 * events already accepted remain queued and are processed in order.
	 */
	readonly send: (event: MachineEventMessage<Events>) => void;

	/**
	 * Scoped `AbortSignal` for the active state generation.
	 * Triggered when transitioning out of this state or when the actor is aborted.
	 */
	readonly signal: AbortSignal;
};

/**
 * Configuration for a single state variant.
 */
type MachineStateConfig<
	S extends AnyMachineState,
	States extends AnyMachineState,
	Events extends Record<string, unknown>,
> = {
	/**
	 * Event transition handlers.
	 */
	readonly on?: { readonly [E in keyof Events & string]?: MachineTransitionHandler<S, Events[E], States>; };

	/**
	 * Lifecycle effect invoked when entering this state.
	 * May return a cleanup disposer function that executes when transitioning out of the state.
	 */
	readonly entry?: (state: S, context: MachineEntryContext<Events>) => void | (() => void);

	/**
	 * Lifecycle effect invoked when exiting this state.
	 */
	readonly exit?: (state: S) => void;
};

/**
 * Complete transition table mapping every state variant in `States` to its configuration.
 */
type MachineTransitionTable<States extends AnyMachineState, Events extends Record<string, unknown>> = {
	readonly [K in States["kind"]]: MachineStateConfig<Extract<States, { readonly kind: K; }>, States, Events>;
};

/**
 * Stateful execution actor returned by {@link Machine.interpret}.
 */
type MachineActor<States extends AnyMachineState, Events extends Record<string, unknown>> = {
	/**
	 * Diagnostic identifier for this running actor instance.
	 */
	readonly id?: string;
	readonly [Symbol.toStringTag]?: string;

	/**
	 * Returns the current active state of the machine.
	 */
	readonly getState: () => States;

	/**
	 * Sends an event to the actor and returns the resulting state.
	 * Re-entrant calls are queued and return the current state before the queued event is processed.
	 */
	readonly send: (event: MachineEventMessage<Events>) => States;

	/**
	 * Subscribes a listener to state changes.
	 * Returns an unsubscribe disposer function.
	 */
	readonly subscribe: (listener: (state: States) => void) => () => void;

	/**
	 * Halts the actor, aborts active state controllers, and runs exit cleanups.
	 */
	readonly abort: () => void;

	/**
	 * Returns whether the actor is currently running.
	 */
	readonly isRunning: () => boolean;
};

/**
 * Options for configuring {@link Machine.interpret}.
 */
type MachineInterpretOptions<
	States extends AnyMachineState,
	Events extends Record<string, unknown>,
	BusEvents extends Record<string, unknown> = Events,
> = {
	/** Initial state for this actor. */
	readonly initial: States;
	/**
	 * An optional diagnostic identifier for this running actor instance.
	 */
	readonly id?: string;

	/**
	 * An optional {@link EventBus} whose messages are forwarded to the actor. The bus must share at
	 * least one event kind with the machine, and shared event payloads must be compatible.
	 */
	readonly bus?: EventBus<BusEvents>;
};

type CompatibleBus<Events extends Record<string, unknown>, BusEvents extends Record<string, unknown>> =
	[keyof Events & keyof BusEvents & string] extends [never] ? never
		: {
			[K in keyof Events & keyof BusEvents & string]: [BusEvents[K]] extends [Events[K]] ? never : K;
		}[keyof Events & keyof BusEvents & string] extends never ? unknown
		: never;

/**
 * A transition table describing named states and their event handlers.
 */
export type Machine<States extends AnyMachineState, Events extends Record<string, unknown>> = {
	readonly [Symbol.toStringTag]?: string;
	readonly states: Machine.TransitionTable<States, Events>;
};

// =============================================================================
// Helper Functions
// =============================================================================

function makeState<Kind extends string>(kind: Kind): MachineState<Kind, void, string>;
function makeState<Kind extends string, Data>(kind: Kind, value: Data): MachineState<Kind, Data, string>;
function makeState<Kind extends string, Data = void>(kind: Kind, value?: Data): MachineState<Kind, Data, string> {
	return (arguments.length > 1 ? { kind, value } : { kind }) as unknown as MachineState<Kind, Data, string>;
}

// =============================================================================
// Module Namespace and Const Literal
// =============================================================================

export namespace Machine {
	export type State<Kind extends string, Data = void, AllowedTargets extends string = string> = MachineState<
		Kind,
		Data,
		AllowedTargets
	>;

	export type EventMessage<Events extends Record<string, unknown>> = MachineEventMessage<Events>;

	export type TransitionHandler<S extends AnyMachineState, Payload, States extends AnyMachineState> =
		MachineTransitionHandler<S, Payload, States>;

	export type EntryContext<Events extends Record<string, unknown>> = MachineEntryContext<Events>;

	export type StateConfig<
		S extends AnyMachineState,
		States extends AnyMachineState,
		Events extends Record<string, unknown>,
	> = MachineStateConfig<S, States, Events>;

	export type TransitionTable<States extends AnyMachineState, Events extends Record<string, unknown>> =
		MachineTransitionTable<States, Events>;

	export type Actor<States extends AnyMachineState, Events extends Record<string, unknown>> = MachineActor<
		States,
		Events
	>;

	export type InterpretOptions<
		States extends AnyMachineState = AnyMachineState,
		Events extends Record<string, unknown> = Record<string, unknown>,
	> = MachineInterpretOptions<States, Events>;
}

type MachineMatchCases<States extends AnyMachineState> = {
	readonly [K in States["kind"]]: (state: Extract<States, { readonly kind: K; }>) => unknown;
};
type HandlerReturn<Handler> = Handler extends (state: any) => infer R ? R : never;
type MachineMatchResult<Cases> = HandlerReturn<Cases[keyof Cases]>;

function matchMachine<States extends AnyMachineState, R>(
	cases: { readonly [K in States["kind"]]: (state: Extract<States, { readonly kind: K; }>) => R; },
): (state: States) => R;
function matchMachine<States extends AnyMachineState, const Cases extends MachineMatchCases<States>>(
	state: States,
	cases: Cases,
): MachineMatchResult<Cases>;
function matchMachine(
	arg1: AnyMachineState | Record<string, (state: any) => unknown>,
	arg2?: Record<string, (state: any) => unknown>,
) {
	if (arg2 === undefined) {
		const cases = arg1 as Record<string, (state: any) => unknown>;
		return (state: AnyMachineState) => cases[state.kind](state);
	}
	const state = arg1 as AnyMachineState;
	return arg2[state.kind](state);
}

export const Machine = {
	/**
	 * Creates a state machine definition from state configurations and event handlers.
	 *
	 * @example
	 * ```ts
	 * type AuthState =
	 *   | Machine.State<"loggedOut", void, "authenticating">
	 *   | Machine.State<"authenticating", { readonly email: string }, "authenticated" | "failed">
	 *   | Machine.State<"authenticated", { readonly token: string }, "loggedOut">
	 *   | Machine.State<"failed", { readonly error: string }, "authenticating" | "loggedOut">;
	 *
	 * type AuthEvents = {
	 *   SUBMIT: { readonly email: string };
	 *   RESOLVE: { readonly token: string };
	 *   REJECT: { readonly error: string };
	 *   LOGOUT: void;
	 * };
	 *
	 * const authMachine = Machine.make<AuthState, AuthEvents>({
	 *   loggedOut: {
	 *     on: {
	 *       SUBMIT: (_state, { email }) => Machine.state("authenticating", { email }),
	 *     },
	 *   },
	 *   authenticating: {
	 *     on: {
	 *       RESOLVE: (_state, { token }) => Machine.state("authenticated", { token }),
	 *       REJECT: (_state, { error }) => Machine.state("failed", { error }),
	 *     },
	 *   },
	 *   authenticated: {
	 *     on: {
	 *       LOGOUT: () => Machine.state("loggedOut"),
	 *     },
	 *   },
	 *   failed: {
	 *     on: {
	 *       SUBMIT: (_state, { email }) => Machine.state("authenticating", { email }),
	 *       LOGOUT: () => Machine.state("loggedOut"),
	 *     },
	 *   },
	 * });
	 * ```
	 */
	make: <States extends AnyMachineState, Events extends Record<string, unknown>>(
		states: MachineTransitionTable<States, Events>,
	): Machine<States, Events> => ({ [Symbol.toStringTag]: "Machine", states: { ...states } }),

	/**
	 * Constructs a state variant without requiring manual type assertions.
	 *
	 * @example
	 * ```ts
	 * const idle = Machine.state("idle");
	 * const active = Machine.state("active", { count: 1 });
	 * ```
	 */
	state: makeState,

	/**
	 * Curried type guard that refines a state to a specific variant kind.
	 *
	 * @example
	 * ```ts
	 * if (Machine.is("authenticating")(state)) {
	 *   console.log(state.value.email);
	 * }
	 * ```
	 */
	is: <K extends string>(kind: K) => <S extends AnyMachineState>(state: S): state is Extract<S, { readonly kind: K; }> =>
		state.kind === kind,

	/**
	 * Exhaustive pattern matcher across all state variants of a machine.
	 *
	 * The data-first form infers state payloads and the union of branch return values. The curried
	 * form remains available for `pipe`, but requires explicit state and return type arguments.
	 *
	 * @example
	 * ```ts
	 * const title = Machine.match(actor.getState(), {
	 *   loggedOut: () => "Please Sign In",
	 *   authenticating: ({ value }) => `Verifying ${value.email}...`,
	 *   authenticated: ({ value }) => `Logged in with token ${value.token}`,
	 *   failed: ({ value }) => `Error: ${value.error}`,
	 * });
	 * ```
	 */
	match: matchMachine,

	/**
	 * Pure, data-last transition function. Evaluates a transition on the provided state
	 * and returns the next state without executing lifecycle side effects.
	 *
	 * If the state does not handle the event, the current state is returned unchanged.
	 * State kinds and event kinds must be declared machine members; external data must be validated
	 * before it enters a machine (garbage-in-garbage-out — a prototype-named kind through a contract
	 * violation is treated as an inherited property, not a member).
	 *
	 * @see {@link Machine.interpret} to run a stateful actor with async lifecycle effects.
	 *
	 * @example
	 * ```ts
	 * const nextState = pipe(
	 *   currentState,
	 *   Machine.transition(authMachine, { kind: "SUBMIT", value: { email: "dev@example.com" } }),
	 * );
	 * ```
	 */
	transition:
		<States extends AnyMachineState, Events extends Record<string, unknown>>(
			machine: Machine<States, Events>,
			event: MachineEventMessage<Events>,
		) =>
		(state: States): States => {
			const config = machine.states[state.kind as States["kind"]];
			if (!config || !config.on) {
				return state;
			}
			const handler = config.on[event.kind as keyof Events & string];
			if (!handler) {
				return state;
			}
			return handler(state as any, (event as { readonly value?: unknown; }).value as any) as States;
		},

	/**
	 * Converters to standard external runtime structures.
	 */
	to: {
		/**
		 * Converts a state machine into an uncurried reducer function `(state, event) => nextState`
		 * directly compatible with React `useReducer`.
		 *
		 * @see {@link Machine.transition} for pure, curried data-last pipeline transitions.
		 *
		 * @example
		 * ```ts
		 * // In React:
		 * const [state, dispatch] = useReducer(
		 *   Machine.to.reducer(checkoutMachine),
		 *   Machine.state("cart"),
		 * );
		 *
		 * ```
		 */
		reducer:
			<States extends AnyMachineState, Events extends Record<string, unknown>>(machine: Machine<States, Events>) =>
			(state: States, event: MachineEventMessage<Events>): States => Machine.transition(machine, event)(state),
	},

	/**
	 * Starts an actor that stores state and runs its entry and exit effects.
	 *
	 * Manages active state lifecycles:
	 * - Runs `entry` effects on state entry, providing an `AbortSignal` and guarded `send`.
	 * - Automatically aborts active controllers and executes cleanup disposers when exiting a state.
	 * - Suppresses stale async dispatches from previously active states.
	 * - Queues re-entrant `send` calls to preserve sequential transition semantics.
	 * - Optionally synchronizes with an {@link EventBus}.
	 * - Propagates synchronous callback errors after completing the active transition or cleanup.
	 *
	 * @see {@link Machine.transition} for pure stateless transitions.
	 *
	 * @example
	 * ```ts
	 * const actor = Machine.interpret(authMachine, { initial: Machine.state("loggedOut") });
	 *
	 * const unsubscribe = actor.subscribe((state) => {
	 *   console.log("Current state:", state.kind);
	 * });
	 *
	 * actor.send({ kind: "SUBMIT", value: { email: "dev@example.com" } });
	 * ```
	 */
	interpret: <
		States extends AnyMachineState,
		Events extends Record<string, unknown>,
		BusEvents extends Record<string, unknown> = Events,
	>(
		machine: Machine<States, Events>,
		options: MachineInterpretOptions<States, Events, BusEvents> & CompatibleBus<Events, BusEvents>,
	): MachineActor<States, Events> => {
		const actorId = options?.id;
		let currentState: States = options.initial;
		let isRunning = true;
		let generation = 0;
		let currentAbortController: AbortController | null = null;
		let currentCleanup: (() => void) | null = null;
		let stateEntered = false;
		let isEntering = false;
		let isProcessing = false;
		let busDisposer: (() => void) | null = null;

		const listeners = new Set<(state: States) => void>();
		const queue: MachineEventMessage<Events>[] = [];
		let pendingError: unknown;
		let hasPendingError = false;

		const reportError = (error: unknown): void => {
			if (!hasPendingError) {
				pendingError = error;
				hasPendingError = true;
			}
		};

		const flushPendingError = (): void => {
			if (hasPendingError) {
				const error = pendingError;
				pendingError = undefined;
				hasPendingError = false;
				throw error;
			}
		};

		const runExitHook = (state: States): void => {
			const config = machine.states[state.kind as States["kind"]];
			if (config?.exit) {
				try {
					config.exit(state as any);
				} catch (error) {
					reportError(error);
				}
			}
		};

		const exitState = (state: States): void => {
			if (!stateEntered) { return; }
			stateEntered = false;
			const controller = currentAbortController;
			const cleanup = currentCleanup;
			currentAbortController = null;
			currentCleanup = null;
			controller?.abort();
			if (isEntering) {
				// An entry hook aborted the actor before returning its disposer. The disposer is
				// not available yet, so defer cleanup and exit until the entry returns and
				// `enterState` runs them in cleanup → exit order.
				return;
			}
			if (cleanup) {
				try {
					cleanup();
				} catch (error) {
					reportError(error);
				}
			}
			runExitHook(state);
		};

		const enterState = (
			state: States,
			currentGen: number,
			dispatch: (event: MachineEventMessage<Events>) => void,
		): void => {
			const controller = new AbortController();
			currentAbortController = controller;
			stateEntered = true;

			const config = machine.states[state.kind as States["kind"]];
			if (!config?.entry) {
				return;
			}

			const guardedSend = (event: MachineEventMessage<Events>): void => {
				if (!isRunning || currentGen !== generation || controller.signal.aborted) {
					return;
				}
				dispatch(event);
			};

			isEntering = true;
			let cleanup: (() => void) | undefined;
			try {
				const result = config.entry(state as any, { send: guardedSend, signal: controller.signal });
				cleanup = typeof result === "function" ? result : undefined;
			} catch (error) {
				reportError(error);
			} finally {
				isEntering = false;
			}

			// An entry hook may abort the actor before returning its disposer. In that case
			// `exitState` deferred cleanup and the exit hook; replay them here in the documented
			// cleanup → exit order. Otherwise store the disposer for the next transition or abort.
			if (!isRunning) {
				if (cleanup !== undefined) {
					try {
						cleanup();
					} catch (error) {
						reportError(error);
					}
				}
				runExitHook(state);
			} else if (cleanup !== undefined) {
				currentCleanup = cleanup;
			}
		};

		const drain = (dispatch: (event: MachineEventMessage<Events>) => States): States => {
			if (isProcessing) {
				return currentState;
			}

			isProcessing = true;
			try {
				while (queue.length > 0) {
					const nextEvent = queue.shift()!;
					const prevState = currentState;
					let nextState: States | null = null;
					try {
						nextState = Machine.transition(machine, nextEvent)(prevState);
					} catch (error) {
						reportError(error);
					}
					if (!isRunning) {
						flushPendingError();
						break;
					}

					if (nextState !== null && nextState !== prevState) {
						exitState(prevState);
						if (!isRunning) {
							flushPendingError();
							break;
						}
						currentState = nextState;
						generation++;
						const currentGen = generation;

						for (const listener of [...listeners]) {
							if (!isRunning) { break; }
							if (listeners.has(listener)) {
								try {
									listener(nextState);
								} catch (error) {
									reportError(error);
								}
							}
						}

						if (isRunning) { enterState(nextState, currentGen, dispatch); }
					}

					flushPendingError();
				}
			} finally {
				isProcessing = false;
			}

			return currentState;
		};
		const send = (event: MachineEventMessage<Events>): States => {
			if (!isRunning) { return currentState; }
			queue.push(event);
			return drain(send);
		};

		// If an EventBus is provided, subscribe to incoming events
		if (options?.bus) {
			busDisposer = EventBus.subscribe(options.bus).tap((msg) => {
				send(msg as unknown as MachineEventMessage<Events>);
			});
		}

		// Run initial state entry effect. A throwing initial entry or transition must not leave
		// a half-initialized actor or bus subscription behind.
		isProcessing = true;
		try {
			try {
				enterState(currentState, generation, send);
			} finally {
				isProcessing = false;
			}
			flushPendingError();
			drain(send);
		} catch (error) {
			isRunning = false;
			queue.length = 0;
			exitState(currentState);
			if (busDisposer) {
				busDisposer();
				busDisposer = null;
			}
			throw error;
		}

		return {
			...(actorId !== undefined ? { id: actorId } : {}),
			[Symbol.toStringTag]: actorId !== undefined ? `Machine.Actor(${actorId})` : "Machine.Actor",
			getState: () => currentState,
			send,
			subscribe: (listener: (state: States) => void) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
			abort: () => {
				if (!isRunning) {
					return;
				}
				isRunning = false;
				queue.length = 0;
				exitState(currentState);
				if (busDisposer) {
					busDisposer();
					busDisposer = null;
				}
				flushPendingError();
			},
			isRunning: () => isRunning,
		};
	},
};
