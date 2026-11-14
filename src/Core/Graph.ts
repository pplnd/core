import type { WithKind } from "../internal/InternalTypes";
import { Aborted } from "./Aborted.ts";
import { Deferred } from "./Deferred.ts";
import { Result } from "./Result.ts";
import { Task } from "./Task.ts";

// =============================================================================
// Phantom Brand Symbols
// =============================================================================
declare const _nodeBrand: unique symbol;
declare const _graphBrand: unique symbol;

const _internalNode = Symbol("Graph.internalNode");
const _internalGraph = Symbol("Graph.internalGraph");

// =============================================================================
// Public Types
// =============================================================================

/**
 * A validated plan for running a target node and its dependencies.
 *
 * The plan checks for cycles when constructed and schedules each node after its dependencies succeed.
 */
export type Graph<E = unknown, Out = unknown, Input = void> = WithKind<"Graph"> & {
	readonly [_graphBrand]: {
		readonly _error: () => E;
		readonly _output: () => Out;
		readonly _input: (_input: Input) => void;
	};
};

type NodeErrorOf<N> = N extends Graph.Node<any, infer E, any, any> ? E : never;

export namespace Graph {
	/**
	 * Represents a distinct, typed node in a Directed Acyclic Graph (DAG).
	 *
	 * Each node has an identifier, an asynchronous computation, and typed dependencies on other nodes.
	 */
	export type Node<Id extends string = string, E = unknown, Out = unknown, Input = void> = WithKind<"GraphNode"> & {
		readonly id: Id;
		readonly [_nodeBrand]: {
			readonly _error: () => E;
			readonly _output: () => Out;
			readonly _input: (_input: Input) => void;
		};
	};

	/**
	 * Matches any valid `Node` instance regardless of generic parameters.
	 *
	 * `Input` defaults to `never` because the input phantom is contravariant: every node accepts
	 * `never`, so `AnyNode<never>` is the wildcard that any node is assignable to.
	 */
	export type AnyNode<Input = never> = Node<string, any, any, Input>;

	/**
	 * Extracts the successful output value type of a `Node`.
	 */
	export type OutputOf<N> = N extends Node<any, any, infer Out, any> ? Out : never;

	/**
	 * Extracts the error type of a `Node`.
	 */
	export type ErrorOf<N> = N extends Node<any, infer E, any, any> ? E : never;

	/**
	 * Maps an object dictionary of dependency nodes to their resolved output value types.
	 */
	export type DepsOutputs<Deps extends Record<string, AnyNode>> = { readonly [K in keyof Deps]: OutputOf<Deps[K]>; };

	/**
	 * Computes the union of error types across all dependency nodes in a dictionary.
	 */
	export type DepsErrors<Deps extends Record<string, AnyNode>> = NodeErrorOf<Deps[keyof Deps]>;

	/**
	 * Execution context for a node's run callback.
	 */
	export type NodeRun<Deps extends Record<string, AnyNode> | undefined, Input, E, Out> = (
		context: {
			readonly ctx: { readonly input: NodeInput<Deps, Input>; };
			readonly deps: Deps extends Record<string, AnyNode> ? DepsOutputs<Deps> : {};
		},
	) => Task.Result<E, Out>;

	/** Creates reusable nodes sharing an input contract. */
	export type NodeFactory<Input> = {
		<Id extends string, E = never, Out = never>(
			id: Id,
			run: NodeRun<undefined, Input, E, Out>,
		): Node<Id, E, Out, NodeInput<undefined, Input>>;
		<Id extends string, const Deps extends Record<string, AnyNode>, E = never, Out = never>(
			id: Id,
			deps: Deps & CompatibleDependencies<Input, Deps>,
			run: NodeRun<Deps, Input, E, Out>,
		): Node<Id, E | DepsErrors<Deps>, Out, NodeInput<Deps, Input>>;
	};

	/** Options controlling graph execution. */
	export type RunOptions = {
		/** Caller cancellation signal. */
		readonly signal?: AbortSignal;
	};

	/**
	 * Options controlling graph execution.
	 */
	export type MakeOptions = {
		/**
		 * Maximum number of asynchronous tasks permitted to execute concurrently.
		 * Defaults to unbounded concurrency. Nonpositive and non-integer values clamp to 1.
		 */
		readonly concurrency?: number;
	};
}

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I
	: never;
// An erased `AnyNode` map carries `never`; treat it as `unknown` so graph construction still
// rejects dependency maps whose input contract cannot be validated.
type InputOf<N> = N extends Graph.Node<any, any, any, infer I> ? ([I] extends [never] ? unknown : I) : never;
type CompatibleDependencies<I, D> = D extends Record<string, Graph.AnyNode>
	? [keyof D] extends [never] ? unknown
	: unknown extends InputOf<D[keyof D]> ? never : [I] extends [DependencyInput<D>] ? unknown
	: never
	: unknown;
type DependencyInput<D> = D extends Record<string, Graph.AnyNode>
	? [keyof D] extends [never] ? unknown
	: unknown extends InputOf<D[keyof D]> ? unknown
	: UnionToIntersection<Exclude<InputOf<D[keyof D]>, void>> extends infer I ? [I] extends [never] ? unknown : I
	: never
	: unknown;
type NodeInput<D, I> = D extends Record<string, Graph.AnyNode>
	? [keyof D] extends [never] ? (unknown extends I ? void : I)
	: unknown extends InputOf<D[keyof D]> ? unknown : unknown extends (I & DependencyInput<D>) ? void
	: I & DependencyInput<D>
	: unknown extends I ? void
	: I;

// =============================================================================
// Internal Representations
// =============================================================================

type InternalNodeState = {
	readonly id: string;
	readonly deps: Readonly<Record<string, Graph.AnyNode>> | undefined;
	readonly run: (
		context: { readonly ctx: { readonly input: unknown; }; readonly deps: Record<string, unknown>; },
	) => Task.Result<unknown, unknown>;
};

type InternalNode<Id extends string, E, Out, Input> = Graph.Node<Id, E, Out, Input> & {
	readonly [_internalNode]: InternalNodeState;
};

type InternalGraphState = {
	readonly target: Graph.AnyNode;
	readonly nodes: readonly Graph.AnyNode[];
	readonly rootNodes: readonly Graph.AnyNode[];
	readonly dependentsMap: Map<Graph.AnyNode, Graph.AnyNode[]>;
	readonly dependencyCountMap: Map<Graph.AnyNode, number>;
	readonly depKeysMap: Map<Graph.AnyNode, readonly [string, Graph.AnyNode][]>;
	readonly options?: Graph.MakeOptions;
};

type InternalGraph<E, Out, Input> = Graph<E, Out, Input> & { readonly [_internalGraph]: InternalGraphState; };

const toInternalNode = <Id extends string, E, Out, Input>(
	node: Graph.Node<Id, E, Out, Input>,
): InternalNode<Id, E, Out, Input> => node as unknown as InternalNode<Id, E, Out, Input>;

const toInternalGraph = <E, Out, Input>(graph: Graph<E, Out, Input>): InternalGraph<E, Out, Input> =>
	graph as unknown as InternalGraph<E, Out, Input>;

// =============================================================================
// Public Constructors & Combinators
// =============================================================================

/**
 * Creates an individual node descriptor for inclusion in a DAG.
 *
 * Dependencies are declared as an object dictionary of upstream nodes.
 * The `run` callback receives the per-run input in `ctx` and dependency outputs in `deps`.
 *
 * @see {@link Graph.make} to compile declared nodes into a validated execution graph.
 * @see {@link Graph.run} for executing compiled graphs.
 *
 * @example
 * ```ts
 * const user = Graph.node("user", () => fetchUser("u_1"));
 *
 * const permissions = Graph.node("permissions", { user }, ({ deps }) =>
 *   fetchPermissions(deps.user.roleId));
 * ```
 */
function makeNode<Id extends string, Input = unknown, E = never, Out = never>(
	id: Id,
	run: Graph.NodeRun<undefined, Input, E, Out>,
): Graph.Node<Id, E, Out, NodeInput<undefined, Input>>;
function makeNode<
	Id extends string,
	const Deps extends Record<string, Graph.AnyNode>,
	Input = unknown,
	E = never,
	Out = never,
>(
	id: Id,
	deps: Deps,
	run: Graph.NodeRun<Deps, Input, E, Out>,
): Graph.Node<Id, E | Graph.DepsErrors<Deps>, Out, NodeInput<Deps, Input>>;
function makeNode(
	id: string,
	arg2: Record<string, Graph.AnyNode> | Graph.NodeRun<any, any, any, any>,
	arg3?: Graph.NodeRun<any, any, any, any>,
) {
	if (id.length === 0) {
		throw new TypeError("[Graph.node] A non-empty string 'id' is required.");
	}

	const hasDeps = typeof arg2 !== "function";
	const deps = hasDeps ? arg2 as Record<string, Graph.AnyNode> : undefined;
	const run = (hasDeps ? arg3 : arg2) as Graph.NodeRun<any, any, any, any> | undefined;

	if (typeof run !== "function") {
		throw new TypeError("[Graph.node] A run callback is required.");
	}

	const nodeObj = {
		kind: "GraphNode" as const,
		id,
		[_internalNode]: { id, deps: deps ? Object.freeze({ ...deps }) : undefined, run },
	};

	return nodeObj as unknown as Graph.Node<string, any, any, any>;
}

/**
 * Builds a reusable execution plan for a target node and its dependencies.
 *
 * Checks for duplicate node IDs and cycles when called. Invalid graphs throw an error.
 *
 * @see {@link Graph.node} for defining upstream DAG nodes.
 * @see {@link Graph.run} for executing compiled graphs.
 *
 * @example
 * ```ts
 * const dashboardGraph = Graph.make(summaryNode);
 * ```
 */
const makeGraph = <Id extends string, E, Out, Input>(
	target: Graph.Node<Id, E, Out, Input> & (unknown extends Input ? never : unknown),
	options?: Graph.MakeOptions,
): Graph<E, Out, Input> => {
	const anyTarget: Graph.AnyNode = target;
	const reachableSet = new Set<Graph.AnyNode>();
	const seenIds = new Map<string, Graph.AnyNode>();
	const stack: Graph.AnyNode[] = [anyTarget];

	const dependentsMap = new Map<Graph.AnyNode, Graph.AnyNode[]>();
	const dependencyCountMap = new Map<Graph.AnyNode, number>();
	const inDegrees = new Map<Graph.AnyNode, number>();
	const depKeysMap = new Map<Graph.AnyNode, readonly [string, Graph.AnyNode][]>();
	const readyQueue: Graph.AnyNode[] = [];

	// 1. Single-pass discovery: DFS reachability traversal, ID uniqueness check,
	// dependency count initialization, dependents adjacency building, and root node identification:
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (!reachableSet.has(current)) {
			const existing = seenIds.get(current.id);
			if (existing !== undefined && existing !== current) {
				throw new Error(
					`[Graph.make] Duplicate node id '${current.id}' detected. Every node in a Graph must have a unique id.`,
				);
			}
			seenIds.set(current.id, current);
			reachableSet.add(current);

			if (!dependentsMap.has(current)) {
				dependentsMap.set(current, []);
			}

			const internal = toInternalNode(current)[_internalNode];
			if (internal.deps) {
				const entries = Object.entries(internal.deps) as readonly [string, Graph.AnyNode][];
				depKeysMap.set(current, entries);
				const count = entries.length;
				dependencyCountMap.set(current, count);
				inDegrees.set(current, count);

				if (count === 0) {
					readyQueue.push(current);
				} else {
					for (let i = 0; i < count; i++) {
						const [, depNode] = entries[i];
						let depList = dependentsMap.get(depNode);
						if (depList === undefined) {
							depList = [];
							dependentsMap.set(depNode, depList);
						}
						depList.push(current);
						stack.push(depNode);
					}
				}
			} else {
				depKeysMap.set(current, []);
				dependencyCountMap.set(current, 0);
				inDegrees.set(current, 0);
				readyQueue.push(current);
			}
		}
	}

	const rootNodes = Object.freeze(readyQueue.slice());

	// 2. Kahn's Algorithm for cycle validation & topological sorting:
	let head = 0;
	while (head < readyQueue.length) {
		const current = readyQueue[head++];
		const dependents = dependentsMap.get(current)!;
		for (let i = 0; i < dependents.length; i++) {
			const dep = dependents[i];
			const rem = inDegrees.get(dep)! - 1;
			inDegrees.set(dep, rem);
			if (rem === 0) {
				readyQueue.push(dep);
			}
		}
	}

	if (readyQueue.length !== reachableSet.size) {
		throw new Error(
			`[Graph.make] Cycle detected in Graph targeting node '${target.id}'. Dependencies must form a Directed Acyclic Graph.`,
		);
	}

	const graphObj = {
		kind: "Graph" as const,
		[_internalGraph]: {
			target: anyTarget,
			nodes: Object.freeze(readyQueue),
			rootNodes,
			dependentsMap,
			dependencyCountMap,
			depKeysMap,
			options,
		},
	};

	return graphObj as unknown as Graph<E, Out, Input>;
};

/**
 * Starts a compiled graph and returns a deferred result.
 *
 * Runs independent nodes concurrently, subject to the configured limit, and runs each shared
 * dependency once per graph execution. If a node returns an error, the graph settles with that
 * error and signals active tasks to abort. Tasks must respond to the signal to stop their work.
 * A caller's abort signal settles the graph with `Aborted` even if active tasks ignore it.
 *
 * @see {@link Graph.make} to compile a target node into a validated graph.
 * @see {@link Graph.node} for defining upstream DAG nodes.
 *
 * A graph with no input is run as `Graph.run()(graph)`. Pass `undefined` as the input when such a
 * graph also needs run options: `Graph.run(undefined, { signal })(graph)`.
 *
 * @example
 * ```ts
 * const outcome = await Graph.run(reportInput)(dashboardGraph);
 * ```
 */
function runGraph(): <E, Out>(graph: Graph<E, Out, void>) => Deferred<Result<E | Aborted, Out>>;
function runGraph<Input>(
	input: Input,
	options?: Graph.RunOptions,
): <E, Out>(graph: Graph<E, Out, Input>) => Deferred<Result<E | Aborted, Out>>;
function runGraph<Input>(input?: Input, runOptions?: Graph.RunOptions) {
	const callerSignal = runOptions?.signal;
	return <E, Out>(graph: Graph<E, Out, Input>): Deferred<Result<E | Aborted, Out>> =>
		Deferred.from.Promise(
			new Promise<Result<E | Aborted, Out>>((resolve) => {
				const internal = toInternalGraph(graph)[_internalGraph];
				const { target, rootNodes, dependentsMap, dependencyCountMap, depKeysMap, options } = internal;

				const internalController = new AbortController();
				const activeSignal = internalController.signal;

				const results = new Map<Graph.AnyNode, unknown>();
				const remainingDeps = new Map<Graph.AnyNode, number>(dependencyCountMap);
				const queue: Graph.AnyNode[] = rootNodes.slice();
				let queueHead = 0;
				let inFlight = 0;
				let isSettled = false;

				let onCallerAbort: () => void;

				const settle = (result: Result<E | Aborted, Out>): void => {
					if (isSettled) {
						return;
					}
					isSettled = true;
					if (callerSignal) {
						callerSignal.removeEventListener("abort", onCallerAbort);
					}
					internalController.abort();
					resolve(result);
				};

				if (callerSignal) {
					const signal = callerSignal;
					onCallerAbort = () => {
						settle(Result.make.err(Aborted.make(signal.reason)));
					};

					if (signal.aborted) {
						onCallerAbort();
						return;
					}
					signal.addEventListener("abort", onCallerAbort, { once: true });
				}

				const concurrency = options?.concurrency === undefined
					? Infinity
					: Number.isInteger(options.concurrency) && options.concurrency > 0
					? options.concurrency
					: 1;

				// oxlint-disable-next-line prefer-const
				let drain: () => void;

				const executeNode = async (node: Graph.AnyNode): Promise<void> => {
					const nodeInternal = toInternalNode(node)[_internalNode];

					// Assemble resolved inputs:
					const depEntries = depKeysMap.get(node);
					let inputs: Record<string, unknown> | undefined;
					if (depEntries && depEntries.length > 0) {
						inputs = {};
						for (let i = 0; i < depEntries.length; i++) {
							const [key, depNode] = depEntries[i];
							inputs[key] = results.get(depNode);
						}
					}

					const task: Task.Result<unknown, unknown> = (signal) =>
						nodeInternal.run({ ctx: { input }, deps: inputs ?? {} })(signal);

					const nodeOutcome = await Deferred.to.Promise(task(activeSignal));

					inFlight--;

					if (Result.is.ok(nodeOutcome)) {
						results.set(node, nodeOutcome.value);

						if (node === target) {
							settle(Result.make.ok(nodeOutcome.value as Out));
							return;
						}

						const dependents = dependentsMap.get(node)!;
						for (let i = 0; i < dependents.length; i++) {
							const dep = dependents[i];
							const rem = remainingDeps.get(dep)! - 1;
							remainingDeps.set(dep, rem);
							if (rem === 0) {
								queue.push(dep);
							}
						}

						drain();
					} else {
						settle(Result.make.err(nodeOutcome.error as E));
					}
				};

				drain = (): void => {
					if (isSettled) {
						return;
					}

					// A node can synchronously abort the caller while it starts.
					// oxlint-disable-next-line no-unmodified-loop-condition
					while (!isSettled && queueHead < queue.length && inFlight < concurrency) {
						const node = queue[queueHead++];
						inFlight++;
						void executeNode(node);
					}
				};

				drain();
			}),
		);
}

// =============================================================================
// Public Module Export
// =============================================================================

/**
 * Runs asynchronous tasks after their dependencies succeed.
 *
 * Shared dependencies run once per execution. Independent nodes can run concurrently, and failures
 * signal active tasks to stop.
 */
export const Graph = {
	/**
	 * Creates a node constructor with a shared input type.
	 *
	 * @example
	 * ```ts
	 * const node = Graph.nodeFactory<ReportInput>();
	 * const customer = node("customer", ({ ctx }) => findCustomer(ctx.input.id));
	 * ```
	 */
	nodeFactory: <Input>(): Graph.NodeFactory<Input> => makeNode as unknown as Graph.NodeFactory<Input>,
	node: makeNode,
	make: makeGraph,
	run: runGraph,
};
