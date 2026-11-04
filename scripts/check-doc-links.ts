import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export interface BrokenLink {
	readonly file: string;
	readonly line: number;
	readonly target: string;
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const FENCE = /^\s*(`{3,}|~{3,})/;

function isFile(filePath: string): boolean {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

function candidatePaths(target: string): string[] {
	const clean = target.replace(/[\\/]+$/, "");
	const candidates = [clean];
	if (!/\.(?:md|mdx)$/i.test(clean)) {
		candidates.push(clean + ".md", clean + ".mdx");
	}
	candidates.push(path.join(clean, "index.md"), path.join(clean, "index.mdx"));
	return [...new Set(candidates)];
}

export function resolveTarget(fromFile: string, target: string, docsRoot: string): string {
	if (target.startsWith("/")) {
		return path.join(docsRoot, target.slice(1));
	}
	return path.resolve(path.dirname(fromFile), target);
}

export function scanMarkdown(text: string, fromFile: string, docsRoot: string): BrokenLink[] {
	const broken: BrokenLink[] = [];
	let fence: string | null = null;

	for (const [index, line] of text.split(/\r?\n/).entries()) {
		const fenceMatch = line.match(FENCE);
		if (fenceMatch) {
			if (fence === null) {
				fence = fenceMatch[1]!.charAt(0);
			} else {
				fence = null;
			}
			continue;
		}
		if (fence !== null) {
			continue;
		}

		const cleaned = line.replace(/`[^`]*`/g, "");
		const targets = [
			...cleaned.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g),
			...cleaned.matchAll(/\bhref="([^"]+)"/g),
		].map((match) => match[1]).filter((target): target is string => Boolean(target));

		for (const rawTarget of targets) {
			const target = rawTarget.trim().replace(/^<|>$/g, "");
			if (!target || target.startsWith("#") || EXTERNAL.test(target)) {
				continue;
			}
			const rawBase = target.split("#")[0]!.split("?")[0]!;
			if (!rawBase) {
				continue;
			}
			let base: string;
			try {
				base = decodeURIComponent(rawBase);
			} catch {
				base = rawBase;
			}
			if (base.startsWith("/api/")) {
				continue;
			}
			const resolved = resolveTarget(fromFile, base, docsRoot);
			if (!candidatePaths(resolved).some(isFile)) {
				broken.push({ file: fromFile, line: index + 1, target });
			}
		}
	}

	return broken;
}

function collectMarkdown(directory: string, files: string[]): void {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === "api") {
			continue;
		}
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			collectMarkdown(entryPath, files);
		} else if (/\.(?:md|mdx)$/i.test(entry.name)) {
			files.push(entryPath);
		}
	}
}

export function findBrokenDocLinks(root = process.cwd()): BrokenLink[] {
	const docsRoot = path.join(root, "docs/src/content/docs");
	const files: string[] = [];
	collectMarkdown(docsRoot, files);
	for (const fileName of ["README.md", "CONTRIBUTING.md"]) {
		const filePath = path.join(root, fileName);
		if (isFile(filePath)) {
			files.push(filePath);
		}
	}

	const broken: BrokenLink[] = [];
	for (const filePath of files) {
		const text = fs.readFileSync(filePath, "utf8");
		broken.push(...scanMarkdown(text, filePath, docsRoot));
	}
	return broken;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const broken = findBrokenDocLinks();
	if (broken.length === 0) {
		console.log("Doc links: 0 broken.");
	} else {
		for (const link of broken) {
			console.error(path.relative(process.cwd(), link.file) + ":" + link.line + " -> " + link.target);
		}
		console.error("Doc links: " + broken.length + " broken.");
		process.exitCode = 1;
	}
}
