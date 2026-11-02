import { constTruthyBool } from "#test-utils";
import { expectTypeOf, test } from "vitest";
import { Duration } from "../../Types/Duration.ts";
import { RetryPolicy } from "../../Types/RetryPolicy.ts";
import { Deferred } from "../Deferred.ts";
import { Graph } from "../Graph.ts";
import { Result } from "../Result.ts";
import { Task } from "../Task.ts";

test("node: infers standalone root node types", () => {
	const userNode = Graph.node("user", {
		run: () =>
			constTruthyBool() ? Task.Result.make.ok({ id: "u1", name: "Alice" }) : Task.Result.make.err("user_err" as const),
	});

	expectTypeOf(userNode).toEqualTypeOf<Graph.Node<"user", "user_err", { id: string; name: string; }>>();

	// @ts-expect-error — run must return Task.Result, not raw number
	Graph.node("bad", { run: () => 42 });

	// @ts-expect-error — deps must be an object map of nodes
	Graph.node("bad", { deps: "not_an_object", run: () => Task.Result.make.ok(1) });
});

test("node: a standalone node has no run input", () => {
	Graph.node("version", {
		run: ({ ctx }) => {
			expectTypeOf(ctx.input).toEqualTypeOf<void>();
			return Task.Result.make.ok(1);
		},
	});
});

test("run: infallible nodes still expose cancellation", () => {
	const node = Graph.node("count", { run: () => Task.Result.make.ok(1) });
	const task = Graph.run(Graph.make(node));
	expectTypeOf(task).toEqualTypeOf<Deferred<Result<Graph.Aborted, number>>>();
});

test("node: infers contextual dependency outputs and accumulates error unions", () => {
	const user = Graph.node("user", {
		run: () =>
			constTruthyBool() ? Task.Result.make.ok({ id: "u1", roleId: "admin" }) : Task.Result.make.err("e_user" as const),
	});

	const config = Graph.node("config", {
		run: () => constTruthyBool() ? Task.Result.make.ok({ region: "us-east" }) : Task.Result.make.err("e_config" as const),
	});

	const permissions = Graph.node("permissions", {
		deps: { user },
		run: ({ deps }) => {
			expectTypeOf(deps.user).toEqualTypeOf<{ id: string; roleId: string; }>();
			return constTruthyBool() ? Task.Result.make.ok(["read", "write"]) : Task.Result.make.err("e_perm" as const);
		},
	});

	expectTypeOf(permissions).toEqualTypeOf<Graph.Node<"permissions", "e_perm" | "e_user", string[]>>();

	const summary = Graph.node("summary", {
		deps: { user, config, permissions },
		run: ({ deps }) => {
			expectTypeOf(deps.user).toEqualTypeOf<{ id: string; roleId: string; }>();
			expectTypeOf(deps.config).toEqualTypeOf<{ region: string; }>();
			expectTypeOf(deps.permissions).toEqualTypeOf<string[]>();
			return Task.Result.timeout({ duration: Duration.seconds(5), onTimeout: () => "e_timeout" as const })(
				Task.Result.make.ok({ count: deps.permissions.length }),
			);
		},
	});

	expectTypeOf(summary).toEqualTypeOf<
		Graph.Node<"summary", "e_timeout" | "e_user" | "e_config" | "e_perm", { count: number; }>
	>();
});

test("make & run: compiles and preserves error and output channels", () => {
	const user = Graph.node("user", {
		run: () => constTruthyBool() ? Task.Result.make.ok({ id: "u1" }) : Task.Result.make.err("e_user" as const),
	});

	const perms = Graph.node("perms", {
		deps: { user },
		run: () => constTruthyBool() ? Task.Result.make.ok(["admin"]) : Task.Result.make.err("e_perm" as const),
	});

	const graph = Graph.make(perms);
	expectTypeOf(graph).toEqualTypeOf<Graph<"e_perm" | "e_user", string[]>>();

	const task = Graph.run(graph);
	expectTypeOf(task).toEqualTypeOf<Deferred<Result<"e_perm" | "e_user" | Graph.Aborted, string[]>>>();

	const taskWithConcurrency = Graph.run(Graph.make(perms, { concurrency: 2 }));
	expectTypeOf(taskWithConcurrency).toEqualTypeOf<Deferred<Result<"e_perm" | "e_user" | Graph.Aborted, string[]>>>();

	const retryingNode = Graph.node("with-retry", {
		run: () =>
			Task.Result.retry(RetryPolicy.constant<"e_retry">({
				attempts: 3,
				delay: Duration.seconds(1),
				when: (err) => err === "e_retry",
				onRetry: (event) => {
					expectTypeOf(event.attempt).toEqualTypeOf<number>();
					expectTypeOf(event.error).toEqualTypeOf<"e_retry">();
					expectTypeOf(event.delay).toEqualTypeOf<Duration>();
				},
			}))(constTruthyBool() ? Task.Result.make.ok("success") : Task.Result.make.err("e_retry" as const)),
	});
	expectTypeOf(retryingNode).toEqualTypeOf<Graph.Node<"with-retry", "e_retry", string>>();

	// @ts-expect-error — target must be a Graph.Node
	Graph.make("not_a_node");

	// @ts-expect-error — run expects a Graph instance
	Graph.run("not_a_graph");
});

test("make and run: infer input through dependencies and retain dynamic input contracts", () => {
	type ReportInput = { customerId: string; };
	const customer = Graph.nodeFactory<ReportInput>()("customer", {
		run: ({ ctx: { input } }) => Task.Result.make.ok({ name: input.customerId }),
	});
	const report = Graph.node("report", {
		deps: { customer },
		run: ({ ctx: { input }, deps }) => {
			expectTypeOf(input).toEqualTypeOf<ReportInput>();
			expectTypeOf(deps.customer).toEqualTypeOf<{ name: string; }>();
			return Task.Result.make.ok(`${deps.customer.name}:${input.customerId}`);
		},
	});
	const graph = Graph.make(report);
	expectTypeOf(graph).toEqualTypeOf<Graph<never, string, ReportInput>>();
	expectTypeOf(Graph.run(graph, { input: { customerId: "a" } })).toEqualTypeOf<
		Deferred<Result<Graph.Aborted, string>>
	>();
	// @ts-expect-error A required graph input cannot be omitted.
	Graph.run(graph);
	// @ts-expect-error The input must contain customerId.
	Graph.run(graph, { input: {} });

	const dynamic: Record<string, Graph.AnyNode<ReportInput>> = { customer };
	const dynamicTarget = Graph.node("dynamic", {
		deps: dynamic,
		run: ({ ctx: { input } }) => Task.Result.make.ok(input.customerId),
	});
	const dynamicGraph = Graph.make(dynamicTarget);
	Graph.run(dynamicGraph, { input: { customerId: "a" } });
	// @ts-expect-error Dynamic dependencies retain their required input.
	Graph.run(dynamicGraph);

	const erased: Record<string, Graph.AnyNode> = { customer };
	const erasedTarget = Graph.node("erased", { deps: erased, run: () => Task.Result.make.ok("done") });
	// @ts-expect-error An erased dependency input cannot be validated.
	Graph.make(erasedTarget);
});

test("make: combines input requirements from independent nodes", () => {
	const customer = Graph.nodeFactory<{ id: string; }>()("customer", {
		run: ({ ctx: { input } }) => Task.Result.make.ok(input.id),
	});
	const locale = Graph.nodeFactory<{ locale: string; }>()("locale", {
		run: ({ ctx: { input } }) => Task.Result.make.ok(input.locale),
	});
	const version = Graph.node("version", { run: () => Task.Result.make.ok(1) });
	const target = Graph.node("report", {
		deps: { customer, locale, version },
		run: ({ ctx: { input }, deps }) => {
			expectTypeOf(input).toEqualTypeOf<{ id: string; } & { locale: string; }>();
			return Task.Result.make.ok(`${deps.customer}:${deps.locale}:${deps.version}`);
		},
	});
	const graph = Graph.make(target);
	Graph.run(graph, { input: { id: "1", locale: "en" } });
	// @ts-expect-error Both input fields are required.
	Graph.run(graph, { input: { id: "1" } });
});

test("node: infers dependency outputs when the node adds an input requirement", () => {
	type CustomerInput = { customerId: string; };
	type ReportInput = CustomerInput & { locale: string; };
	const customer = Graph.nodeFactory<CustomerInput>()("customer", {
		run: ({ ctx: { input } }) => Task.Result.make.ok({ name: input.customerId }),
	});
	const report = Graph.nodeFactory<ReportInput>()("report", {
		deps: { customer },
		run: ({ ctx: { input }, deps: { customer: customerData } }) => {
			expectTypeOf(customerData).toEqualTypeOf<{ name: string; }>();
			return Task.Result.make.ok(`${customerData.name}:${input.locale}`);
		},
	});
	const graph = Graph.make(report);
	expectTypeOf(Graph.run(graph, { input: { customerId: "1", locale: "en" } })).toEqualTypeOf<
		Deferred<Result<Graph.Aborted, string>>
	>();
	// @ts-expect-error The report needs the locale as well as customerId.
	Graph.run(graph, { input: { customerId: "1" } });
});

test("nodeFactory: shares input while retaining typed dependency and output inference", () => {
	type Input = { readonly id: string; readonly locale: string; };
	const node = Graph.nodeFactory<Input>();
	const customer = node("customer", { run: ({ ctx: { input } }) => Task.Result.make.ok({ name: input.id }) });
	const shared = Graph.nodeFactory<{ readonly id: string; }>()("shared", {
		run: ({ ctx: { input } }) => Task.Result.make.ok(input.id),
	});
	const version = Graph.node("version", { run: () => Task.Result.make.ok(1) });
	const report = node("report", {
		deps: { customer, shared, version },
		run: ({ ctx: { input }, deps: { customer: data, shared: id, version: number } }) => {
			expectTypeOf(input).toMatchTypeOf<Input>();
			expectTypeOf<Input>().toMatchTypeOf<typeof input>();
			expectTypeOf(data).toEqualTypeOf<{ name: string; }>();
			expectTypeOf(id).toEqualTypeOf<string>();
			expectTypeOf(number).toEqualTypeOf<number>();
			return Task.Result.make.ok(`${data.name}:${input.locale}:${number}`);
		},
	});
	const graph = Graph.make(report);
	expectTypeOf(Graph.run(graph, { input: { id: "a", locale: "en" } })).toEqualTypeOf<
		Deferred<Result<Graph.Aborted, string>>
	>();
	Graph.make(customer);
	// @ts-expect-error A run must provide the full factory input.
	Graph.run(graph, { input: { id: "a" } });

	const other = Graph.nodeFactory<{ readonly tenant: number; }>()("other", {
		run: ({ ctx: { input } }) => Task.Result.make.ok(input.tenant),
	});
	// @ts-expect-error A dependency requiring a different input cannot be used by this factory.
	node("invalid", { deps: { other }, run: () => Task.Result.make.ok(1) });
});

test("nodeFactory: infers task-level retry and timeout error channels", () => {
	type Input = { readonly path: string; };
	const node = Graph.nodeFactory<Input>();
	const source = node("source", {
		run: ({ ctx }) => {
			expectTypeOf(ctx.input).toEqualTypeOf<Input>();
			return Task.Result.timeout({ duration: Duration.seconds(1), onTimeout: (): "timeout" => "timeout" })(
				Task.Result.retry(RetryPolicy.exponential({ attempts: 3, initial: Duration.milliseconds(10) }))(
					Task.Result.make.ok(ctx.input.path),
				),
			);
		},
	});
	const report = node("report", {
		deps: { source },
		run: ({ ctx, deps }) => Task.Result.make.ok(`${ctx.input.path}:${deps.source}`),
	});
	expectTypeOf(source.id).toEqualTypeOf<"source">();
	expectTypeOf<Graph.ErrorOf<typeof source>>().toEqualTypeOf<"timeout">();
	expectTypeOf(Graph.run(Graph.make(report), { input: { path: "report" } })).toEqualTypeOf<
		Deferred<Result<"timeout" | Graph.Aborted, string>>
	>();
});
