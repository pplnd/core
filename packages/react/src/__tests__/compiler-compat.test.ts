import { transformSync } from "@babel/core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

// React Compiler compatibility audit against the BABEL implementation (the Rust/SWC
// pipeline fails at transform time via panicThreshold: "all_errors"). Every shipped hook
// source is compiled here directly — deterministic, independent of the suite's transform
// worker caching — and every record must be a CompileSuccess. A bail-out fails the test,
// which is the invariant: consumers running the React Compiler must get compiled hooks,
// not silently skipped ones.

type CompilerEvent = { kind: string; detail: string | null; };

const hookSources = ["useLoad.ts", "useOp.ts", "useOpPoll.ts", "useEventBus.ts", "useMachine.ts", "useActor.ts"];

test("compiler-compat: every hook compiles under the Babel React Compiler without bail-outs", () => {
	const srcDir = path.resolve(import.meta.dirname, "..");
	const records: Array<{ file: string; events: CompilerEvent[]; }> = [];
	for (const hook of hookSources) {
		const events: CompilerEvent[] = [];
		const out = transformSync(readFileSync(path.join(srcDir, hook), "utf8"), {
			filename: path.join(srcDir, hook),
			babelrc: false,
			configFile: false,
			sourceType: "module",
			parserOpts: { plugins: ["typescript", "jsx"] },
			plugins: [["babel-plugin-react-compiler", {
				logger: {
					logEvent(_fnName: string, event: CompilerEvent) {
						events.push(event);
					},
				},
			}]],
		});
		expect(out === null ? "" : out.code).not.toBe("");
		records.push({ file: hook, events });
	}

	for (const { file, events } of records) {
		const problems = events.filter((event) => event.kind !== "CompileSuccess");
		expect(problems, `${file} compiled with bail-outs`).toStrictEqual([]);
		expect(events, `${file} was never attempted`).not.toHaveLength(0);
	}
});
