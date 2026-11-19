import { ok } from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { GUIDE_BUNDLE_SIZES, MODULE_BUNDLE_SIZES } from "../../../../docs/src/data/bundle-sizes.ts";
import { EXPORT_DOMAINS } from "../../../../docs/src/data/export-domains.ts";
import { NAV_ENTRIES, type NavEntry } from "../../../../docs/src/nav.ts";
import { GUIDE_MANIFEST, resolveGuideModules, STANDALONE_MODULES } from "../../../../scripts/docs-manifest.ts";

const repoRoot = path.resolve(__dirname, "../../../../");
const coreRoot = path.join(repoRoot, "packages/core");
const guidesDir = path.join(repoRoot, "docs/src/content/docs/guides");

interface SizeItem {
	name: string;
	size: number;
	sizeLimit?: number;
	passed?: boolean;
}

function formatBytes(bytes: number): string {
	if (bytes < 1000) {
		return `${bytes} B`;
	}
	return `${(bytes / 1000).toFixed(2)} kB`;
}

function getMeasuredSizes(): Map<string, SizeItem> {
	// Fallback build only when dist has not been produced yet; `size:check` runs `pnpm build` first.
	if (!fs.existsSync(path.join(coreRoot, "dist/index.mjs"))) {
		execSync("pnpm build", { cwd: coreRoot, stdio: "pipe" });
	}
	let raw: string;
	try {
		raw = execSync("npx size-limit --json", { cwd: coreRoot, encoding: "utf8" });
	} catch (error) {
		// size-limit exits non-zero when a budget fails; its stdout still carries the JSON report,
		// so measure from it and let the assertions name the failing targets instead of crashing
		// the whole file at module load.
		raw = (error as { stdout?: string; }).stdout ?? "";
		if (raw === "") {
			throw error;
		}
	}
	const items = JSON.parse(raw) as SizeItem[];
	const map = new Map<string, SizeItem>();
	for (const item of items) {
		map.set(item.name, item);
	}
	return map;
}

function guideFiles(): string[] {
	return fs.readdirSync(guidesDir).filter((file) => /\.(?:md|mdx)$/iu.test(file)).sort();
}

const sizeMap = getMeasuredSizes();

function aggregateGuideProblems(): string[] {
	const problems: string[] = [];
	for (const [filename, entry] of Object.entries(GUIDE_MANIFEST)) {
		if (resolveGuideModules(entry).length === 0) {
			const content = fs.readFileSync(path.join(guidesDir, filename), "utf8");
			if (content.includes("BUNDLE_SIZE:START")) {
				problems.push(`${filename}: aggregate guide has a bundle badge`);
			}
		}
	}
	return problems;
}

function budgetedGuideProblems(): string[] {
	const problems: string[] = [];
	for (const [filename, entry] of Object.entries(GUIDE_MANIFEST)) {
		const content = fs.readFileSync(path.join(guidesDir, filename), "utf8");
		if (content.includes("BUNDLE_SIZE:START")) {
			problems.push(`${filename}: guide still contains a legacy BUNDLE_SIZE badge`);
		}
		for (const moduleName of resolveGuideModules(entry)) {
			if (!sizeMap.has(moduleName)) {
				problems.push(`${filename}: no size-limit target for ${moduleName}`);
			}
		}
	}
	return problems;
}

test("BundleSize: enforces size-limit budgets across all targets", () => {
	for (const item of sizeMap.values()) {
		expect(item.passed).toBe(true);
	}
});

test("BundleSize: every entry measures the published entry file", () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(coreRoot, "package.json"), "utf8")) as {
		"size-limit": Array<{ name: string; path: string; }>;
	};
	const nonPublished = pkg["size-limit"].filter((item) => item.path !== "dist/index.mjs").map((item) =>
		`${item.name}: measures ${item.path} instead of the published entry`
	);
	expect(nonPublished).toStrictEqual([]);
});

test("BundleSize: verifies README.md reflects current measured sizes", () => {
	const content = fs.readFileSync(path.join(coreRoot, "README.md"), "utf8");

	expect(content).toContain("<!-- BUNDLE_TABLE:START -->");
	expect(content).toContain("<!-- BUNDLE_TABLE:END -->");

	for (const name of ["Machine", "Result", "Maybe", "Op", "EventBus", "pipe"]) {
		const item = sizeMap.get(name);
		expect(item).toBeDefined();
		expect(content).toContain(formatBytes(item!.size));
	}
});

test("BundleSize: every measured import appears once in the Installation size groups", () => {
	const expected = STANDALONE_MODULES.map((name) => {
		const item = sizeMap.get(name);
		ok(item, `Missing size-limit target for ${name}`);
		return { module: name, bytes: item.size, formatted: formatBytes(item.size) };
	});
	expect(Object.values(MODULE_BUNDLE_SIZES)).toStrictEqual(expected);

	const groupedNames = EXPORT_DOMAINS.flatMap(({ exports }) =>
		exports.filter((name) => Object.hasOwn(MODULE_BUNDLE_SIZES, name))
	);
	expect(groupedNames.sort()).toStrictEqual([...STANDALONE_MODULES].sort());
});

test("BundleSize: verifies docs/src/data/bundle-sizes.ts reflects current measured sizes", () => {
	const expected = Object.entries(GUIDE_MANIFEST).flatMap(([filename, entry]) => {
		const modules = resolveGuideModules(entry);
		if (modules.length === 0) {
			return [];
		}
		const slug = `guides/${filename.replace(/\.(?:md|mdx)$/iu, "").toLowerCase()}`;
		return [{
			slug,
			value: {
				importFrom: "@pplnd/core" as const,
				entries: modules.map((name) => {
					const item = sizeMap.get(name);
					expect(item).toBeDefined();
					return { module: name, bytes: item!.size, formatted: formatBytes(item!.size) };
				}),
			},
		}];
	}).toSorted((left, right) => (left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0));

	expect(Object.keys(GUIDE_BUNDLE_SIZES).toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0)))
		.toStrictEqual(expected.map((item) => item.slug));

	for (const { slug, value } of expected) {
		expect(GUIDE_BUNDLE_SIZES[slug]).toStrictEqual(value);
	}
});

test("BundleSize: every guide file has a manifest entry", () => {
	for (const file of guideFiles()) {
		expect(Object.hasOwn(GUIDE_MANIFEST, file)).toBe(true);
	}
});

test("BundleSize: every manifest entry exists", () => {
	for (const filename of Object.keys(GUIDE_MANIFEST)) {
		expect(fs.existsSync(path.join(guidesDir, filename))).toBe(true);
	}
});

test("BundleSize: aggregate guides do not claim a module size", () => {
	expect(aggregateGuideProblems()).toStrictEqual([]);
});

test("BundleSize: budgeted guides have a size-limit target and no inline badge", () => {
	expect(budgetedGuideProblems()).toStrictEqual([]);
});

function collectNavSlugs(entries: readonly NavEntry[]): Set<string> {
	const slugs = new Set<string>();
	for (const entry of entries) {
		if (entry.kind === "link") {
			slugs.add(entry.slug);
		} else {
			for (const item of entry.items) {
				slugs.add(item.slug);
			}
		}
	}
	return slugs;
}

test("BundleSize: every guide file is in the docs sidebar", () => {
	const navSlugs = collectNavSlugs(NAV_ENTRIES);
	for (const file of guideFiles()) {
		const base = file.replace(/\.(?:md|mdx)$/iu, "");
		expect(navSlugs.has(`guides/${base}`)).toBe(true);
	}
});
