import { transformSync } from "@babel/core";
import type { Plugin } from "vite";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.ts";

// The React Compiler compatibility suite against the BABEL implementation. Every shipped
// hook source is transformed with babel-plugin-react-compiler so the whole behavioral suite
// — render-count tests included — runs on compiler output; compiler-compat.test.ts audits
// compilability deterministically (every hook must be a CompileSuccess, bail-outs fail).
//
// A hand-rolled @babel/core transform is used instead of @vitejs/plugin-react: the latter
// skips Babel on files without JSX, which would silently exempt the .ts hook sources from
// compilation.

function babelReactCompiler(): Plugin {
	return {
		name: "react-compiler-babel",
		enforce: "pre",
		transform(code, id) {
			const file = id.split("?")[0] ?? id;
			if (!/\.ts$/u.test(file) || file.includes("node_modules") || file.includes("__tests__")) {
				return null;
			}
			const out = transformSync(code, {
				filename: file,
				babelrc: false,
				configFile: false,
				sourceType: "module",
				parserOpts: { plugins: ["typescript", "jsx"] },
				plugins: [["babel-plugin-react-compiler"]],
			});
			return out?.code ? { code: out.code, map: out.map ?? null } : null;
		},
	};
}

export default mergeConfig(base, defineConfig({ plugins: [babelReactCompiler()] }));
