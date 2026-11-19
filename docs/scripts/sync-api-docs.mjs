import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const DOCS_PKG_ROOT = path.resolve(import.meta.dirname, "..");
const STAGE_ROOT = path.join(DOCS_PKG_ROOT, ".astro/typedoc-stage");
const API_ROOT = path.join(DOCS_PKG_ROOT, "src/content/docs/api");
const require = createRequire(import.meta.url);
const TYPEDOC_BIN = path.join(path.dirname(require.resolve("typedoc/package.json")), "bin/typedoc");

function collectFiles(dir, out = []) {
	if (!fs.existsSync(dir)) {
		return out;
	}
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			collectFiles(full, out);
		} else {
			out.push(full);
		}
	}
	return out;
}

function rewriteLinks(content, fromDir, apiBaseRoot) {
	return content.replace(/\]\((?<raw>[^)\s]+)\)/gu, (full, raw) => {
		if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/iu.test(raw)) {
			return full;
		}
		const hashIdx = raw.indexOf("#");
		const queryIdx = raw.indexOf("?");
		const splitIdx = hashIdx === -1 ? queryIdx : queryIdx === -1 ? hashIdx : Math.min(hashIdx, queryIdx);
		const cleanPath = splitIdx === -1 ? raw : raw.slice(0, splitIdx);
		const suffix = splitIdx === -1 ? "" : raw.slice(splitIdx);
		if (!/\.(?:md|mdx)$/iu.test(cleanPath)) {
			return full;
		}

		const absTarget = path.resolve(fromDir, cleanPath);
		const rel = path.relative(apiBaseRoot, absTarget).split(path.sep).join("/");
		if (!rel || rel.startsWith("..")) {
			return full;
		}

		const slug = rel.replace(/\.(?:md|mdx)$/iu, "").replace(/(?:^|\/)index$/iu, "").replace(/\/$/u, "").toLowerCase();
		return `](${slug ? `/api/${slug}/` : "/api/"}${suffix})`;
	});
}

function rewriteTreeLinks(rootDir) {
	for (const file of collectFiles(rootDir)) {
		if (!/\.mdx?$/iu.test(file)) {
			continue;
		}
		const original = fs.readFileSync(file, "utf8");
		const updated = rewriteLinks(original, path.dirname(file), rootDir);
		if (updated !== original) {
			fs.writeFileSync(file, updated, "utf8");
		}
	}
}

function pruneEmptyDirs(dir) {
	if (!fs.existsSync(dir)) {
		return true;
	}
	let empty = true;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!pruneEmptyDirs(full)) {
				empty = false;
			} else {
				fs.rmdirSync(full);
			}
		} else {
			empty = false;
		}
	}
	return empty;
}

function syncStageToApi() {
	fs.mkdirSync(API_ROOT, { recursive: true });
	const stagedFiles = collectFiles(STAGE_ROOT);
	const expectedRel = new Set();

	for (const srcFile of stagedFiles) {
		const rel = path.relative(STAGE_ROOT, srcFile);
		expectedRel.add(rel);
		const destFile = path.join(API_ROOT, rel);
		const content = fs.readFileSync(srcFile, "utf8");
		if (fs.existsSync(destFile) && fs.readFileSync(destFile, "utf8") === content) {
			continue;
		}
		fs.mkdirSync(path.dirname(destFile), { recursive: true });
		fs.writeFileSync(destFile, content, "utf8");
	}

	for (const existingFile of collectFiles(API_ROOT)) {
		const rel = path.relative(API_ROOT, existingFile);
		if (!expectedRel.has(rel)) {
			fs.rmSync(existingFile, { force: true });
		}
	}
	for (const entry of fs.readdirSync(API_ROOT, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			const full = path.join(API_ROOT, entry.name);
			if (pruneEmptyDirs(full)) {
				fs.rmdirSync(full);
			}
		}
	}
}

function ensureApiIndex(rootDir) {
	const readme = path.join(rootDir, "README.md");
	const index = path.join(rootDir, "index.md");
	if (!fs.existsSync(readme)) {
		return;
	}
	const content = fs.readFileSync(readme, "utf8");
	if (!fs.existsSync(index) || fs.readFileSync(index, "utf8") !== content) {
		fs.writeFileSync(index, content, "utf8");
	}
}

const ifMissing = process.argv.includes("--if-missing");
if (ifMissing && fs.existsSync(path.join(API_ROOT, "README.md"))) {
	rewriteTreeLinks(API_ROOT);
	ensureApiIndex(API_ROOT);
} else {
	fs.rmSync(STAGE_ROOT, { recursive: true, force: true });
	execFileSync(process.execPath, [TYPEDOC_BIN, "--options", "typedoc.api.json"], {
		cwd: DOCS_PKG_ROOT,
		stdio: "inherit",
	});
	rewriteTreeLinks(STAGE_ROOT);
	ensureApiIndex(STAGE_ROOT);
	syncStageToApi();
	fs.rmSync(STAGE_ROOT, { recursive: true, force: true });
}
