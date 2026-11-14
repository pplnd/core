import { constTruthyBool } from "#test-utils";
import { expectTypeOf, test } from "vitest";
import { Duration } from "../../Types/Duration.ts";
import { RetryPolicy } from "../../Types/RetryPolicy.ts";
import { TimeoutPolicy } from "../../Types/TimeoutPolicy.ts";
import { Aborted } from "../Aborted.ts";
import { Deferred } from "../Deferred.ts";
import { Graph } from "../Graph.ts";
import { Result } from "../Result.ts";
import { Task } from "../Task.ts";

test("node: infers standalone root node types", () => {
	const userNode = Graph.node(
		"user",
		() =>
			constTruthyBool() ? Task.Result.make.ok({ id: "u1", name: "Alice" }) : Task.Result.make.err("user_err" as const),
	);

	expectTypeOf(userNode).toEqualTypeOf<Graph.Node<"user", "user_err", { id: string; name: string; }>>();

	// @ts-expect-error — run must return Task.Result, not raw number
	Graph.node("bad", () => 42);

	// @ts-expect-error — deps must be an object map of nodes
	Graph.node("bad", "not_an_object", () => Task.Result.make.ok(1));
});

test("node: a standalone node has no run input", () => {
	Graph.node("version", ({ ctx }) => {
		expectTypeOf(ctx.input).toEqualTypeOf<void>();
		return Task.Result.make.ok(1);
	});
});

test("run: infallible nodes still expose cancellation", () => {
	const node = Graph.node("count", () => Task.Result.make.ok(1));
	const task = Graph.run()(Graph.make(node));
	expectTypeOf(task).toEqualTypeOf<Deferred<Result<Aborted, number>>>();
});

test("node: infers contextual dependency outputs and accumulates error unions", () => {
	const user = Graph.node(
		"user",
		() =>
			constTruthyBool() ? Task.Result.make.ok({ id: "u1", roleId: "admin" }) : Task.Result.make.err("e_user" as const),
	);

	const config = Graph.node(
		"config",
		() => constTruthyBool() ? Task.Result.make.ok({ region: "us-east" }) : Task.Result.make.err("e_config" as const),
	);

	const permissions = Graph.node("permissions", { user }, ({ deps }) => {
		expectTypeOf(deps.user).toEqualTypeOf<{ id: string; roleId: string; }>();
		return constTruthyBool() ? Task.Result.make.ok(["read", "write"]) : Task.Result.make.err("e_perm" as const);
	});

	expectTypeOf(permissions).toEqualTypeOf<Graph.Node<"permissions", "e_perm" | "e_user", string[]>>();

	const summary = Graph.node("summary", { user, config, permissions }, ({ deps }) => {
		expectTypeOf(deps.user).toEqualTypeOf<{ id: string; roleId: string; }>();
		expectTypeOf(deps.config).toEqualTypeOf<{ region: string; }>();
		expectTypeOf(deps.permissions).toEqualTypeOf<string[]>();
		return Task.Result.timeout(
			TimeoutPolicy.after({ duration: Duration.seconds(5), onTimeout: () => "e_timeout" as const }),
		)(Task.Result.make.ok({ count: deps.permissions.length }));
	});

	expectTypeOf(summary).toEqualTypeOf<
		Graph.Node<"summary", "e_timeout" | "e_user" | "e_config" | "e_perm", { count: number; }>
	>();
});

test("make & run: compiles and preserves error and output channels", () => {
	const user = Graph.node(
		"user",
		() => constTruthyBool() ? Task.Result.make.ok({ id: "u1" }) : Task.Result.make.err("e_user" as const),
	);

	const perms = Graph.node(
		"perms",
		{ user },
		() => constTruthyBool() ? Task.Result.make.ok(["admin"]) : Task.Result.make.err("e_perm" as const),
	);

	const graph = Graph.make(perms);
	expectTypeOf(graph).toEqualTypeOf<Graph<"e_perm" | "e_user", string[]>>();

	const task = Graph.run()(graph);
	expectTypeOf(task).toEqualTypeOf<Deferred<Result<"e_perm" | "e_user" | Aborted, string[]>>>();

	const taskWithConcurrency = Graph.run()(Graph.make(perms, { concurrency: 2 }));
	expectTypeOf(taskWithConcurrency).toEqualTypeOf<Deferred<Result<"e_perm" | "e_user" | Aborted, string[]>>>();

	const retryingNode = Graph.node(
		"with-retry",
		() =>
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
	);
	expectTypeOf(retryingNode).toEqualTypeOf<Graph.Node<"with-retry", "e_retry", string>>();

	// @ts-expect-error — target must be a Graph.Node
	Graph.make("not_a_node");

	// @ts-expect-error — run expects a Graph instance
	Graph.run()("not_a_graph");
});

test("make and run: infer input through dependencies and retain dynamic input contracts", () => {
	type ReportInput = { customerId: string; };
	const customer = Graph.nodeFactory<ReportInput>()(
		"customer",
		({ ctx: { input } }) => Task.Result.make.ok({ name: input.customerId }),
	);
	const report = Graph.node("report", { customer }, ({ ctx: { input }, deps }) => {
		expectTypeOf(input).toEqualTypeOf<ReportInput>();
		expectTypeOf(deps.customer).toEqualTypeOf<{ name: string; }>();
		return Task.Result.make.ok(`${deps.customer.name}:${input.customerId}`);
	});
	const graph = Graph.make(report);
	expectTypeOf(graph).toEqualTypeOf<Graph<never, string, ReportInput>>();
	expectTypeOf(Graph.run({ customerId: "a" })(graph)).toEqualTypeOf<Deferred<Result<Aborted, string>>>();
	// @ts-expect-error A required graph input cannot be omitted.
	Graph.run()(graph);
	// @ts-expect-error The input must contain customerId.
	Graph.run({})(graph);

	const dynamic: Record<string, Graph.AnyNode<ReportInput>> = { customer };
	const dynamicTarget = Graph.node("dynamic", dynamic, ({ ctx: { input } }) => Task.Result.make.ok(input.customerId));
	const dynamicGraph = Graph.make(dynamicTarget);
	Graph.run({ customerId: "a" })(dynamicGraph);
	// @ts-expect-error Dynamic dependencies retain their required input.
	Graph.run()(dynamicGraph);

	const erased: Record<string, Graph.AnyNode> = { customer };
	const erasedTarget = Graph.node("erased", erased, () => Task.Result.make.ok("done"));
	// @ts-expect-error An erased dependency input cannot be validated.
	Graph.make(erasedTarget);
});

test("make: combines input requirements from independent nodes", () => {
	const customer = Graph.nodeFactory<{ id: string; }>()(
		"customer",
		({ ctx: { input } }) => Task.Result.make.ok(input.id),
	);
	const locale = Graph.nodeFactory<{ locale: string; }>()(
		"locale",
		({ ctx: { input } }) => Task.Result.make.ok(input.locale),
	);
	const version = Graph.node("version", () => Task.Result.make.ok(1));
	const target = Graph.node("report", { customer, locale, version }, ({ ctx: { input }, deps }) => {
		expectTypeOf(input).toEqualTypeOf<{ id: string; } & { locale: string; }>();
		return Task.Result.make.ok(`${deps.customer}:${deps.locale}:${deps.version}`);
	});
	const graph = Graph.make(target);
	Graph.run({ id: "1", locale: "en" })(graph);
	// @ts-expect-error Both input fields are required.
	Graph.run({ id: "1" })(graph);
});

test("node: infers dependency outputs when the node adds an input requirement", () => {
	type CustomerInput = { customerId: string; };
	type ReportInput = CustomerInput & { locale: string; };
	const customer = Graph.nodeFactory<CustomerInput>()(
		"customer",
		({ ctx: { input } }) => Task.Result.make.ok({ name: input.customerId }),
	);
	const report = Graph.nodeFactory<ReportInput>()(
		"report",
		{ customer },
		({ ctx: { input }, deps: { customer: customerData } }) => {
			expectTypeOf(customerData).toEqualTypeOf<{ name: string; }>();
			return Task.Result.make.ok(`${customerData.name}:${input.locale}`);
		},
	);
	const graph = Graph.make(report);
	expectTypeOf(Graph.run({ customerId: "1", locale: "en" })(graph)).toEqualTypeOf<Deferred<Result<Aborted, string>>>();
	// @ts-expect-error The report needs the locale as well as customerId.
	Graph.run({ customerId: "1" })(graph);
});

test("nodeFactory: shares input while retaining typed dependency and output inference", () => {
	type Input = { readonly id: string; readonly locale: string; };
	const node = Graph.nodeFactory<Input>();
	const customer = node("customer", ({ ctx: { input } }) => Task.Result.make.ok({ name: input.id }));
	const shared = Graph.nodeFactory<{ readonly id: string; }>()(
		"shared",
		({ ctx: { input } }) => Task.Result.make.ok(input.id),
	);
	const version = Graph.node("version", () => Task.Result.make.ok(1));
	const report = node(
		"report",
		{ customer, shared, version },
		({ ctx: { input }, deps: { customer: data, shared: id, version: number } }) => {
			expectTypeOf(input).toMatchTypeOf<Input>();
			expectTypeOf<Input>().toMatchTypeOf<typeof input>();
			expectTypeOf(data).toEqualTypeOf<{ name: string; }>();
			expectTypeOf(id).toEqualTypeOf<string>();
			expectTypeOf(number).toEqualTypeOf<number>();
			return Task.Result.make.ok(`${data.name}:${input.locale}:${number}`);
		},
	);
	const graph = Graph.make(report);
	expectTypeOf(Graph.run({ id: "a", locale: "en" })(graph)).toEqualTypeOf<Deferred<Result<Aborted, string>>>();
	Graph.make(customer);
	// @ts-expect-error A run must provide the full factory input.
	Graph.run({ id: "a" })(graph);

	const other = Graph.nodeFactory<{ readonly tenant: number; }>()(
		"other",
		({ ctx: { input } }) => Task.Result.make.ok(input.tenant),
	);
	// @ts-expect-error A dependency requiring a different input cannot be used by this factory.
	node("invalid", { other }, () => Task.Result.make.ok(1));
});

test("nodeFactory: infers task-level retry and timeout error channels", () => {
	type Input = { readonly path: string; };
	const node = Graph.nodeFactory<Input>();
	const source = node("source", ({ ctx }) => {
		expectTypeOf(ctx.input).toEqualTypeOf<Input>();
		return Task.Result.timeout(
			TimeoutPolicy.after({ duration: Duration.seconds(1), onTimeout: (): "timeout" => "timeout" }),
		)(
			Task.Result.retry(RetryPolicy.exponential({ attempts: 3, initial: Duration.milliseconds(10) }))(
				Task.Result.make.ok(ctx.input.path),
			),
		);
	});
	const report = node("report", { source }, ({ ctx, deps }) => Task.Result.make.ok(`${ctx.input.path}:${deps.source}`));
	expectTypeOf(source.id).toEqualTypeOf<"source">();
	expectTypeOf<Graph.ErrorOf<typeof source>>().toEqualTypeOf<"timeout">();
	expectTypeOf(Graph.run({ path: "report" })(Graph.make(report))).toEqualTypeOf<
		Deferred<Result<"timeout" | Aborted, string>>
	>();
});

test("input variance: richer input cannot be narrowed, narrower input can be widened", () => {
	type RichInput = { readonly userId: string; readonly adminToken: string; };
	type NarrowInput = { readonly userId: string; };

	const richGraph = Graph.make(
		Graph.nodeFactory<RichInput>()("rich", ({ ctx }) => Task.Result.make.ok(ctx.input.adminToken)),
	);
	const narrowGraph = Graph.make(
		Graph.nodeFactory<NarrowInput>()("narrow", ({ ctx }) => Task.Result.make.ok(ctx.input.userId)),
	);

	const widened: Graph<never, string, RichInput> = narrowGraph;
	// @ts-expect-error a graph requiring adminToken cannot run with only userId
	const narrowed: Graph<never, string, NarrowInput> = richGraph;

	expectTypeOf(widened).toEqualTypeOf<Graph<never, string, RichInput>>();
	expectTypeOf(narrowed).toEqualTypeOf<Graph<never, string, NarrowInput>>();
});

test("DepsErrors: an empty dependency map contributes no error channel", () => {
	expectTypeOf<Graph.DepsErrors<{}>>().toEqualTypeOf<never>();

	const root = Graph.node("root", {}, () => Task.Result.make.ok(1));
	expectTypeOf(root).toEqualTypeOf<Graph.Node<"root", never, number>>();
});
