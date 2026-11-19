import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { GUIDE_MANIFEST, resolveGuideModules, STANDALONE_MODULES } from "./docs-manifest.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const coreRoot = path.join(projectRoot, "packages/core");

interface SizeItem {
	name: string;
	size: number;
	sizeLimit?: number;
	passed?: boolean;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1000) {
		return `${bytes} B`;
	}
	const kb = bytes / 1000;
	return `${kb.toFixed(2)} kB`;
}

export function getMeasuredSizes(): Map<string, SizeItem> {
	// Always rebuild so the synced badges describe the current tree, not a stale dist.
	execSync("pnpm build", { cwd: coreRoot, stdio: "inherit" });
	const raw = execSync("pnpm size-limit --json", { cwd: coreRoot, encoding: "utf8" });
	const items = JSON.parse(raw) as SizeItem[];
	const map = new Map<string, SizeItem>();
	for (const item of items) {
		map.set(item.name, item);
	}
	return map;
}

export function requireSize(sizeMap: Map<string, SizeItem>, target: string): number {
	const item = sizeMap.get(target);
	if (!item) {
		throw new Error(`Bundle size sync failed: target "${target}" not found in size-limit output.`);
	}
	return item.size;
}

export function buildBundleTables(sizeMap: Map<string, SizeItem>): string {
	const standaloneRows = STANDALONE_MODULES.map((name) => {
		const item = sizeMap.get(name);
		if (!item) {
			return "";
		}
		return `| \x60${name}\x60 | **${formatBytes(item.size)}** |`;
	}).filter(Boolean).join("\n");

	return `### Standalone Module Footprint (Tree-Shaken)

These measurements include each listed import and its dependencies, minified and gzipped:

| Import Pattern | Minified + Gzipped |
| :--- | :--- |
${standaloneRows}
`;
}

export function updateReadme(sizeMap: Map<string, SizeItem>): string {
	const readmePath = path.join(coreRoot, "README.md");
	let content = fs.readFileSync(readmePath, "utf8");

	const standaloneSizes = STANDALONE_MODULES.map((name) => requireSize(sizeMap, name));
	const minIndividual = Math.min(...standaloneSizes);
	const maxIndividual = Math.max(...standaloneSizes);
	const indexSize = requireSize(sizeMap, "Index (Monolithic import *)");

	const overviewReplacement = `<!-- BUNDLE_OVERVIEW:START -->
It has zero dependencies, ships ESM and CommonJS builds, and tree-shakes down to ~${formatBytes(minIndividual)}–${
		formatBytes(maxIndividual)
	} gzipped for individual modules and ${formatBytes(indexSize)} for the entire package.
<!-- BUNDLE_OVERVIEW:END -->`;

	if (content.includes("<!-- BUNDLE_OVERVIEW:START -->")) {
		content = content.replace(/<!-- BUNDLE_OVERVIEW:START -->[\s\S]*?<!-- BUNDLE_OVERVIEW:END -->/u, overviewReplacement);
	} else {
		content = content.replace(
			/It has zero dependencies, ships ESM and CommonJS builds[\s\S]*?\(<20 KB for the whole package\)\./u,
			overviewReplacement,
		);
	}

	const tables = buildBundleTables(sizeMap);
	const tableReplacement = `<!-- BUNDLE_TABLE:START -->\n${tables}\n<!-- BUNDLE_TABLE:END -->`;

	if (content.includes("<!-- BUNDLE_TABLE:START -->")) {
		content = content.replace(/<!-- BUNDLE_TABLE:START -->[\s\S]*?<!-- BUNDLE_TABLE:END -->/u, tableReplacement);
	} else {
		content = `## Package Architecture and Performance

All entry points are published with \x60"sideEffects": false\x60 and structured as static constant objects without class prototypes or closure side-effects. Modern bundlers (Vite, Rollup, webpack, esbuild, Next.js) automatically tree-shake unused functions and modules, bundling only the specific symbols imported by your application.

${tableReplacement}

`;
	}

	fs.writeFileSync(readmePath, content, "utf8");
	return readmePath;
}

export function updateBundleSizeData(sizeMap: Map<string, SizeItem>): string {
	const outPath = path.join(projectRoot, "docs/src/data/bundle-sizes.ts");
	const moduleRecords = STANDALONE_MODULES.map((name) => {
		const module = JSON.stringify(name);
		const bytes = requireSize(sizeMap, name);
		return `\t${module}: { module: ${module}, bytes: ${bytes}, formatted: ${JSON.stringify(formatBytes(bytes))} },`;
	});
	const filenames = Object.keys(GUIDE_MANIFEST).toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0));
	const guideRecords: string[] = [];

	for (const filename of filenames) {
		const entry = GUIDE_MANIFEST[filename as keyof typeof GUIDE_MANIFEST];
		const modules = resolveGuideModules(entry);
		if (modules.length === 0) {
			continue;
		}
		const slug = `guides/${filename.replace(/\.(?:md|mdx)$/iu, "").toLowerCase()}`;
		const items = modules.map((name) => `MODULE_BUNDLE_SIZES[${JSON.stringify(name)}]`).join(", ");
		guideRecords.push(`\t${JSON.stringify(slug)}: { importFrom: "@pplnd/core", entries: [${items}] },`);
	}

	const output = `// Generated by \`pnpm size:update\` (\`scripts/sync-bundle-sizes.ts\`). Do not edit by hand.

export interface ModuleSizeEntry {
	readonly module: string;
	readonly bytes: number;
	readonly formatted: string;
}

export interface GuideBundleSize {
	readonly importFrom: "@pplnd/core";
	readonly entries: readonly ModuleSizeEntry[];
}

export const MODULE_BUNDLE_SIZES = {
${moduleRecords.join("\n")}
} as const satisfies Readonly<Record<string, ModuleSizeEntry>>;

export const GUIDE_BUNDLE_SIZES: Readonly<Record<string, GuideBundleSize>> = {
${guideRecords.join("\n")}
};
`;

	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, output, "utf8");
	return outPath;
}

export function syncAll(): void {
	console.log("Measuring bundle sizes via size-limit...");
	const sizeMap = getMeasuredSizes();
	console.log(`Measured ${sizeMap.size} size targets.`);

	console.log("Updating README.md...");
	const readme = updateReadme(sizeMap);

	console.log("Updating docs/src/data/bundle-sizes.ts...");
	const sizeData = updateBundleSizeData(sizeMap);

	console.log("Formatting synchronized files with dprint...");
	try {
		execFileSync("pnpm", ["exec", "dprint", "fmt", "--config", "dprint.md.json", readme], {
			cwd: projectRoot,
			stdio: "inherit",
		});
		execFileSync("pnpm", ["exec", "dprint", "fmt", sizeData], { cwd: projectRoot, stdio: "inherit" });
	} catch (error) {
		console.warn("Formatting failed or dprint not found:", error);
	}

	console.log("Bundle sizes synchronized successfully.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	syncAll();
}
