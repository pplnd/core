import fs from "node:fs";
import path from "node:path";

function getBarrelExports(relativePath: string): string[] {
	const candidates = [
		path.resolve(process.cwd(), "..", relativePath),
		path.resolve(process.cwd(), relativePath),
		path.resolve(import.meta.dirname, "../../..", relativePath),
	];
	const fullPath = candidates.find((candidate) => fs.existsSync(candidate));
	if (!fullPath) {
		throw new Error(`Cannot find the core export barrel at ${relativePath}.`);
	}
	const source = fs.readFileSync(fullPath, "utf8");
	const matches = source.matchAll(/export\s+\*\s+from\s+["']\.\/(?<name>[^"']+)["']/gu);
	return [...matches].flatMap(({ groups }) => groups?.name === undefined ? [] : [groups.name]).sort();
}

export const EXPORT_DOMAINS = [{
	title: "Errors, Async & State",
	description:
		"Discriminated unions for error handling, optional values, async execution, event streams, state, and optics.",
	exports: getBarrelExports("packages/core/src/Core/index.ts"),
}, {
	title: "Data & Collections",
	description: "Pure curried utilities for arrays, records, dictionaries, strings, numbers, and JSON.",
	exports: getBarrelExports("packages/core/src/Data/index.ts"),
}, {
	title: "Pipelines & Composition",
	description: "Pipeline runners, flow composition, and execution control combinators.",
	exports: getBarrelExports("packages/core/src/Composition/index.ts"),
}, {
	title: "Domain Types",
	description: "Primitives, compile-time branded types, duration units, and retry policies.",
	exports: getBarrelExports("packages/core/src/Types/index.ts"),
}];
