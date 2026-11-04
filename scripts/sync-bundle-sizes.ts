import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { GUIDE_MANIFEST, STANDALONE_MODULES } from "./docs-manifest.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

interface SizeItem {
	name: string;
	size: number;
	sizeLimit?: number;
	passed?: boolean;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1000) {
		return bytes + " B";
	}
	const kb = bytes / 1000;
	return kb.toFixed(2) + " kB";
}

export function getMeasuredSizes(): Map<string, SizeItem> {
	const coreDist = path.join(projectRoot, "dist/index.mjs");
	if (!fs.existsSync(coreDist)) {
		execSync("pnpm build", { cwd: projectRoot, stdio: "inherit" });
	}
	const raw = execSync("pnpm size-limit --json", { cwd: projectRoot, encoding: "utf8" });
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
		throw new Error('Bundle size sync failed: target "' + target + '" not found in size-limit output.');
	}
	return item.size;
}

export function buildBundleTables(sizeMap: Map<string, SizeItem>): string {
	const standaloneRows = STANDALONE_MODULES.map((name) => {
		const item = sizeMap.get(name);
		if (!item) {
			return "";
		}
		return "| \x60" + name + "\x60 | **" + formatBytes(item.size) + "** |";
	}).filter(Boolean).join("\n");

	return "### Standalone Module Footprint (Tree-Shaken)\n\n"
		+ "These measurements include each listed import and its dependencies, minified and gzipped:\n\n"
		+ "| Import Pattern | Minified + Gzipped |\n"
		+ "| :--- | :--- |\n"
		+ standaloneRows + "\n";
}

export function updateReadme(sizeMap: Map<string, SizeItem>): string {
	const readmePath = path.join(projectRoot, "README.md");
	let content = fs.readFileSync(readmePath, "utf8");

	const standaloneSizes = STANDALONE_MODULES.map((name) => requireSize(sizeMap, name));
	const minIndividual = Math.min(...standaloneSizes);
	const maxIndividual = Math.max(...standaloneSizes);
	const indexSize = requireSize(sizeMap, "Index (Monolithic import *)");

	const overviewReplacement =
		"<!-- BUNDLE_OVERVIEW:START -->\nIt has zero dependencies, ships ESM and CommonJS builds, and tree-shakes down to ~"
		+ formatBytes(minIndividual) + "–" + formatBytes(maxIndividual) + " gzipped for individual modules and "
		+ formatBytes(indexSize) + " for the entire package.\n<!-- BUNDLE_OVERVIEW:END -->";

	if (content.includes("<!-- BUNDLE_OVERVIEW:START -->")) {
		content = content.replace(/<!-- BUNDLE_OVERVIEW:START -->[\s\S]*?<!-- BUNDLE_OVERVIEW:END -->/, overviewReplacement);
	} else {
		content = content.replace(
			/It has zero dependencies, ships ESM and CommonJS builds[\s\S]*?\(<20 KB for the whole package\)\./,
			overviewReplacement,
		);
	}

	const tables = buildBundleTables(sizeMap);
	const tableReplacement = "<!-- BUNDLE_TABLE:START -->\n" + tables + "\n<!-- BUNDLE_TABLE:END -->";

	if (content.includes("<!-- BUNDLE_TABLE:START -->")) {
		content = content.replace(/<!-- BUNDLE_TABLE:START -->[\s\S]*?<!-- BUNDLE_TABLE:END -->/, tableReplacement);
	} else {
		content = "## Package Architecture and Performance\n\n"
			+ 'All entry points are published with \x60"sideEffects": false\x60 and structured as static constant objects without class prototypes or closure side-effects. Modern bundlers (Vite, Rollup, webpack, esbuild, Next.js) automatically tree-shake unused functions and modules, bundling only the specific symbols imported by your application.\n\n'
			+ tableReplacement + "\n\n";
	}

	fs.writeFileSync(readmePath, content, "utf8");
	return readmePath;
}

export function updateInstallationDoc(sizeMap: Map<string, SizeItem>): string {
	const docPath = path.join(projectRoot, "docs/src/content/docs/basics/installation.mdx");
	let content = fs.readFileSync(docPath, "utf8");

	const tables = buildBundleTables(sizeMap);
	const tableReplacement = "{/* BUNDLE_TABLE:START */}\n" + tables + "\n{/* BUNDLE_TABLE:END */}";

	const existingTablePattern =
		/(?:<!--\s*BUNDLE_TABLE:START\s*-->[\s\S]*?<!--\s*BUNDLE_TABLE:END\s*-->|\{\/\*\s*BUNDLE_TABLE:START\s*\*\/\}[\s\S]*?\{\/\*\s*BUNDLE_TABLE:END\s*\*\/\})/;

	if (existingTablePattern.test(content)) {
		content = content.replace(existingTablePattern, tableReplacement);
	} else {
		const treeShakingPattern =
			/### Tree-Shaking\s*\n\s*All entry points are published with \x60"sideEffects": false\x60[\s\S]*?(?=## Requirements)/;
		const sectionReplacement = "### Tree-Shaking & Bundle Impact\n\n"
			+ 'All entry points are published with \x60"sideEffects": false\x60 and structured as static constant objects without class prototypes or closure side-effects. Modern bundlers (Vite, Rollup, webpack, esbuild, Next.js) automatically tree-shake unused functions and modules, bundling only the specific symbols imported by your application.\n\n'
			+ tableReplacement + "\n\n";
		content = content.replace(treeShakingPattern, sectionReplacement);
	}

	fs.writeFileSync(docPath, content, "utf8");
	return docPath;
}

export function updateGuides(sizeMap: Map<string, SizeItem>): string[] {
	const guidesDir = path.join(projectRoot, "docs/src/content/docs/guides");
	const updated: string[] = [];

	for (const [filename, entry] of Object.entries(GUIDE_MANIFEST)) {
		if (entry.module === null) {
			continue;
		}
		const filePath = path.join(guidesDir, filename);
		if (!fs.existsSync(filePath)) {
			continue;
		}

		let content = fs.readFileSync(filePath, "utf8");
		const item = sizeMap.get(entry.module);
		if (!item) {
			continue;
		}

		const isMdx = filename.endsWith(".mdx");
		const startTag = isMdx ? "{/* BUNDLE_SIZE:START */}" : "<!-- BUNDLE_SIZE:START -->";
		const endTag = isMdx ? "{/* BUNDLE_SIZE:END */}" : "<!-- BUNDLE_SIZE:END -->";
		const callout = startTag + "\n\n> " + formatBytes(item.size) + " minified + gzipped\n\n" + endTag;

		const anyExistingPattern =
			/(?:<!--\s*BUNDLE_SIZE:START\s*-->[\s\S]*?<!--\s*BUNDLE_SIZE:END\s*-->|\{\/\*\s*BUNDLE_SIZE:START\s*\*\/\}[\s\S]*?\{\/\*\s*BUNDLE_SIZE:END\s*\*\/\})\r?\n*/g;
		content = content.replace(anyExistingPattern, "");

		const frontmatterMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
		if (frontmatterMatch) {
			const endOfFrontmatter = frontmatterMatch[0].length;
			content = content.slice(0, endOfFrontmatter) + callout + "\n\n" + content.slice(endOfFrontmatter).trimStart();
		} else {
			content = callout + "\n\n" + content;
		}

		fs.writeFileSync(filePath, content, "utf8");
		updated.push(filePath);
	}

	return updated;
}

export function syncAll(): void {
	console.log("Measuring bundle sizes via size-limit...");
	const sizeMap = getMeasuredSizes();
	console.log("Measured " + sizeMap.size + " size targets.");

	console.log("Updating README.md...");
	const readme = updateReadme(sizeMap);

	console.log("Updating docs/src/content/docs/basics/installation.mdx...");
	const installation = updateInstallationDoc(sizeMap);

	console.log("Updating guides in docs/src/content/docs/guides/...");
	const guides = updateGuides(sizeMap);

	const modified = [readme, installation, ...guides];
	console.log("Formatting " + modified.length + " modified documents with dprint...");
	try {
		execFileSync("pnpm", ["exec", "dprint", "fmt", "--config", "dprint.md.json", ...modified], {
			cwd: projectRoot,
			stdio: "inherit",
		});
	} catch (error) {
		console.warn("Formatting failed or dprint not found:", error);
	}

	console.log("Bundle sizes synchronized successfully.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	syncAll();
}
