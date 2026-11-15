import { transformSync } from "@swc/core";
import type { Plugin } from "vite";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.ts";

// The React Compiler compatibility suite against the NATIVE RUST implementation — the same
// codebase Rspack/Rsbuild 2.1+ ship via `builtin:swc-loader` (`jsc.transform.reactCompiler`),
// upstreamed into standalone @swc/core. The Babel plugin and this port are separate
// implementations whose bail-out behavior can diverge, so both are CI invariants.
//
// `panicThreshold: "all_errors"` makes the Rust compiler ERROR on any function it cannot
// compile instead of silently skipping — a bail-out fails the suite at transform time, which
// is the invariant. No logger log is needed here.

function swcReactCompiler(): Plugin {
	return {
		name: "react-compiler-swc",
		enforce: "pre",
		transform(code, id) {
			const file = id.split("?")[0] ?? id;
			if (!/\.ts$/u.test(file) || file.includes("node_modules") || file.includes("__tests__")) {
				return null;
			}
			const out = transformSync(code, {
				filename: file,
				isModule: true,
				sourceMaps: false,
				jsc: {
					parser: { syntax: "typescript", tsx: true },
					transform: { react: { runtime: "automatic" }, reactCompiler: { panicThreshold: "all_errors" } },
					target: "es2022",
				},
				module: { type: "es6" },
			});
			return { code: out.code, map: out.map ?? null };
		},
	};
}

export default mergeConfig(
	base,
	defineConfig({
		plugins: [swcReactCompiler()],
		test: {
			// The JSONL bail-out audit is a Babel-pipeline concern; the Rust pipeline fails at
			// transform time via panicThreshold.
			exclude: [...base.test?.exclude ?? [], "**/compiler-compat.test.ts"],
		},
	}),
);
