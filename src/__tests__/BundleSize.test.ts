import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { GUIDE_MANIFEST } from "../../scripts/docs-manifest.ts";

const projectRoot = path.resolve(__dirname, "../../");
const guidesDir = path.join(projectRoot, "docs/src/content/docs/guides");

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
	// Always rebuild: a stale dist would report sizes for code that is no longer in the tree.
	execSync("pnpm build", { cwd: projectRoot, stdio: "pipe" });
	const raw = execSync("npx size-limit --json", { cwd: projectRoot, encoding: "utf8" });
	const items = JSON.parse(raw) as SizeItem[];
	const map = new Map<string, SizeItem>();
	for (const item of items) {
		map.set(item.name, item);
	}
	return map;
}

function guideFiles(): string[] {
	return fs.readdirSync(guidesDir).filter((file) => /\.(?:md|mdx)$/i.test(file)).sort();
}

const sizeMap = getMeasuredSizes();

function aggregateGuideProblems(): string[] {
	const problems: string[] = [];
	for (const [filename, entry] of Object.entries(GUIDE_MANIFEST)) {
		if (entry.module === null) {
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
		if (entry.module !== null) {
			const content = fs.readFileSync(path.join(guidesDir, filename), "utf8");
			const isMdx = filename.endsWith(".mdx");
			const startTag = isMdx ? "{/* BUNDLE_SIZE:START */}" : "<!-- BUNDLE_SIZE:START -->";
			const occurrences = (content.match(/BUNDLE_SIZE:START/g) || []).length;
			if (!content.includes(startTag)) {
				problems.push(`${filename}: missing bundle badge`);
			}
			if (occurrences !== 1) {
				problems.push(`${filename}: expected one bundle badge, found ${occurrences}`);
			}

			const item = sizeMap.get(entry.module);
			if (!item) {
				problems.push(`${filename}: no size-limit target for ${entry.module}`);
			} else if (!content.includes(`> ${formatBytes(item.size)} minified + gzipped`)) {
				problems.push(`${filename}: stale bundle size`);
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
	const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
		"size-limit": Array<{ name: string; path: string; }>;
	};
	const nonPublished = pkg["size-limit"].filter((item) => item.path !== "dist/index.mjs").map((item) =>
		`${item.name}: measures ${item.path} instead of the published entry`
	);
	expect(nonPublished).toStrictEqual([]);
});

test("BundleSize: verifies README.md reflects current measured sizes", () => {
	const content = fs.readFileSync(path.join(projectRoot, "README.md"), "utf8");

	expect(content).toContain("<!-- BUNDLE_TABLE:START -->");
	expect(content).toContain("<!-- BUNDLE_TABLE:END -->");

	for (const name of ["Machine", "Result", "Maybe", "Op", "EventBus", "pipe"]) {
		const item = sizeMap.get(name);
		expect(item).toBeDefined();
		expect(content).toContain(formatBytes(item!.size));
	}
});

test("BundleSize: verifies installation.mdx reflects current measured sizes", () => {
	const content = fs.readFileSync(path.join(projectRoot, "docs/src/content/docs/basics/installation.mdx"), "utf8");

	expect(content).toContain("{/* BUNDLE_TABLE:START */}");
	expect(content).toContain("{/* BUNDLE_TABLE:END */}");

	for (const name of ["Machine", "Result", "Maybe", "Resource", "Task"]) {
		const item = sizeMap.get(name);
		expect(item).toBeDefined();
		expect(content).toContain(formatBytes(item!.size));
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

test("BundleSize: budgeted guides have exactly one current badge", () => {
	expect(budgetedGuideProblems()).toStrictEqual([]);
});

test("BundleSize: every guide file is in the docs sidebar", () => {
	const config = fs.readFileSync(path.join(projectRoot, "docs/astro.config.mjs"), "utf8");
	for (const file of guideFiles()) {
		const base = file.replace(/\.(?:md|mdx)$/i, "");
		expect(config).toContain(`slug: "guides/${base}"`);
	}
});
