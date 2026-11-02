import fc from "fast-check";
import { expect, test } from "vitest";
import { Graph } from "../Graph.ts";
import { Result } from "../Result.ts";
import { Task } from "../Task.ts";

test("property: linear chain evaluates to the cumulative fold of all nodes", async () => {
	await fc.assert(
		fc.asyncProperty(fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 8 }), async (numbers) => {
			let currentNode: Graph.AnyNode<void> = Graph.node("node_0", { run: () => Task.Result.make.ok(numbers[0]) });

			for (let i = 1; i < numbers.length; i++) {
				const prevNode = currentNode;
				const val = numbers[i];
				currentNode = Graph.node(`node_${i}`, {
					deps: { prev: prevNode },
					run: ({ deps: { prev } }) => Task.Result.make.ok(prev + val),
				});
			}

			const graph = Graph.make(currentNode);
			const outcome = await Graph.run(graph);

			const expectedSum = numbers.reduce((acc, n) => acc + n, 0);
			expect(outcome).toStrictEqual(Result.make.ok(expectedSum));
		}),
	);
});

test("property: diamond DAG guarantees single execution of root node across inputs", async () => {
	await fc.assert(fc.asyncProperty(fc.integer(), fc.integer(), async (a, b) => {
		let rootCount = 0;

		const rootNode = Graph.node("root", {
			run: () => {
				rootCount++;
				return Task.Result.make.ok(a);
			},
		});

		const branch1Node = Graph.node("b1", {
			deps: { root: rootNode },
			run: ({ deps: { root } }) => Task.Result.make.ok(root + b),
		});

		const branch2Node = Graph.node("b2", {
			deps: { root: rootNode },
			run: ({ deps: { root } }) => Task.Result.make.ok(root * 2),
		});

		const sinkNode = Graph.node("sink", {
			deps: { branch1: branch1Node, branch2: branch2Node },
			run: ({ deps: { branch1, branch2 } }) => Task.Result.make.ok(branch1 + branch2),
		});

		const graph = Graph.make(sinkNode);
		const outcome = await Graph.run(graph);

		expect(rootCount).toBe(1);
		expect(outcome).toStrictEqual(Result.make.ok((a + b) + (a * 2)));
	}));
});

test("property: any single failure short-circuits the entire graph to that Err", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.string({ minLength: 1 }),
			fc.array(fc.integer(), { minLength: 2, maxLength: 5 }),
			fc.nat({ max: 4 }),
			async (errorMsg, values, failIndexRaw) => {
				const failIndex = failIndexRaw % values.length;

				const nodes = values.map((val, idx) =>
					Graph.node(`n_${idx}`, {
						run: () => idx === failIndex ? Task.Result.make.err(errorMsg) : Task.Result.make.ok(val),
					})
				);

				const depsMap: Record<string, Graph.AnyNode<void>> = {};
				for (let i = 0; i < nodes.length; i++) {
					depsMap[`n_${i}`] = nodes[i];
				}

				const sink = Graph.node("sink", { deps: depsMap, run: ({ deps }) => Task.Result.make.ok(deps) });

				const graph = Graph.make(sink);
				const outcome = await Graph.run(graph);

				expect(outcome).toStrictEqual(Result.make.err(errorMsg));
			},
		),
	);
});

test("property: concurrency option bounds active in-flight tasks across DAG executions", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.integer({ min: 1, max: 3 }),
			fc.array(fc.integer({ min: 5, max: 15 }), { minLength: 3, maxLength: 6 }),
			async (concurrency, delays) => {
				let inFlight = 0;
				let maxInFlight = 0;

				const nodes = delays.map((delayMs, idx) =>
					Graph.node(`n_${idx}`, {
						run: () =>
							Task.Result.tryCatch(async () => {
								inFlight++;
								maxInFlight = Math.max(maxInFlight, inFlight);
								await new Promise((resolve) => setTimeout(resolve, delayMs));
								inFlight--;
								return idx;
							}, { onError: String }),
					})
				);

				const depsMap: Record<string, Graph.AnyNode<void>> = {};
				for (let i = 0; i < nodes.length; i++) {
					depsMap[`n_${i}`] = nodes[i];
				}

				const sink = Graph.node("sink", { deps: depsMap, run: ({ deps }) => Task.Result.make.ok(deps) });
				const graph = Graph.make(sink, { concurrency });

				const outcome = await Graph.run(graph);
				expect(Result.is.ok(outcome)).toBe(true);
				expect(maxInFlight).toBeLessThanOrEqual(concurrency);
			},
		),
	);
});
