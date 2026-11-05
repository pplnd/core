import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type * as Api from "../src/index.ts";

type RuntimeApi = typeof import("../src/index.ts");

const benchmarkedModules = ["Arr", "Rec", "Dict", "Uniq", "Str", "Num"] as const;
type BenchmarkedModule = typeof benchmarkedModules[number];

const root = fileURLToPath(new URL("..", import.meta.url));
const benchDir = join(root, "src/Data/__bench__");
const manifestUrl = new URL("../benchmarks/coverage.json", import.meta.url);

const sources = [
	...readdirSync(benchDir).filter((file) => file.endsWith(".bench.ts")).map((file) =>
		readFileSync(join(benchDir, file), "utf8")
	),
	readFileSync(new URL("./bench-gate.ts", import.meta.url), "utf8"),
].join("\n");

const api = (await import(new URL("../dist/index.mjs", import.meta.url).href)) as RuntimeApi;

const leavesOf = (moduleName: BenchmarkedModule): string[] => {
	const module = api[moduleName] as Record<string, unknown>;
	const leaves: string[] = [];
	for (const key of Object.keys(module)) {
		const value = module[key];
		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			for (const nestedKey of Object.keys(value as Record<string, unknown>)) {
				leaves.push(`${moduleName}.${key}.${nestedKey}`);
			}
		} else {
			leaves.push(`${moduleName}.${key}`);
		}
	}
	return leaves;
};

const referenced = (leaf: string): boolean => new RegExp(`\\b${leaf.replaceAll(".", "\\.")}\\b`).test(sources);

type Manifest = { note: string; outOfScope: string[]; };

const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as Manifest;
const allowed = new Set(manifest.outOfScope);
const problems: string[] = [];
const missing: string[] = [];
const summary: Array<{ module: string; covered: number; total: number; }> = [];

for (const moduleName of benchmarkedModules) {
	const leaves = leavesOf(moduleName);
	let covered = 0;
	for (const leaf of leaves) {
		const isAllowed = allowed.has(leaf);
		const isUsed = referenced(leaf);
		if (isUsed) {
			covered++;
			if (isAllowed) { problems.push(`${leaf} is benchmarked but also listed as out of scope`); }
		} else if (isAllowed) {
			// Explicitly out of scope.
		} else {
			missing.push(leaf);
			problems.push(`${leaf} has no benchmark and is not listed in outOfScope`);
		}
	}
	summary.push({ module: moduleName, covered, total: leaves.length });
}

const allLeaves = new Set(benchmarkedModules.flatMap(leavesOf));
for (const entry of allowed) {
	if (!allLeaves.has(entry)) {
		problems.push(`${entry} is listed in outOfScope but is not a public leaf of a benchmarked module`);
	}
}

console.log("\nBenchmark coverage (modules with a __bench__ file):");
for (const row of summary) {
	console.log(
		`  ${row.module.padEnd(5)} ${String(row.covered).padStart(3)}/${String(row.total).padEnd(3)} leaves referenced`,
	);
}
console.log("  BigNum, Bool, and Json have no benchmark suite and are not assessed.");

if (missing.length > 0) {
	console.log(
		"\nAdd a benchmark (in a __bench__ file or scripts/bench-gate.ts) or an outOfScope entry in benchmarks/coverage.json for:",
	);
	for (const leaf of missing) { console.log(`  "${leaf}"`); }
}

if (problems.length > 0) {
	console.error(`\n${problems.length} benchmark coverage problem(s):`);
	for (const problem of problems) { console.error(`  - ${problem}`); }
	process.exitCode = 1;
} else {
	console.log(
		`\nCoverage contract satisfied: ${summary.length} modules, every leaf benchmarked or explicitly out of scope.`,
	);
}
