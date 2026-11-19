import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export interface BrokenLink {
	readonly file: string;
	readonly line: number;
	readonly target: string;
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu;
const FENCE = /^\s*(?<fence>`{3,}|~{3,})/u;

function isFile(filePath: string): boolean {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

function candidatePaths(target: string): string[] {
	const clean = target.replace(/[\\/]+$/u, "");
	const candidates = [clean];
	if (!/\.(?:md|mdx)$/iu.test(clean)) {
		candidates.push(`${clean}.md`, `${clean}.mdx`);
	}
	candidates.push(path.join(clean, "index.md"), path.join(clean, "index.mdx"));
	return [...new Set(candidates)];
}

function collectApiTargets(docsRoot: string): Set<string> | null {
	const apiDir = path.join(docsRoot, "api");
	if (!fs.existsSync(apiDir)) {
		return null;
	}
	const targets = new Set<string>();
	const stack = [apiDir];
	while (stack.length > 0) {
		const current = stack.pop()!;
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(full);
			} else if (/\.(?:md|mdx)$/iu.test(entry.name)) {
				const rel = path.relative(apiDir, full).split(path.sep).join("/").toLowerCase();
				const noExt = rel.replace(/\.(?:md|mdx)$/iu, "");
				targets.add(`/api/${rel}`);
				targets.add(`/api/${noExt}`);
				if (noExt === "index") {
					targets.add("/api");
				} else if (noExt.endsWith("/index")) {
					targets.add(`/api/${noExt.slice(0, -"/index".length)}`);
				}
			}
		}
	}
	return targets;
}

export function resolveTarget(fromFile: string, target: string, docsRoot: string): string {
	if (target.startsWith("/")) {
		return path.join(docsRoot, target.slice(1));
	}
	return path.resolve(path.dirname(fromFile), target);
}

export function scanMarkdown(
	text: string,
	fromFile: string,
	docsRoot: string,
	apiTargets: ReadonlySet<string> | null = collectApiTargets(docsRoot),
): BrokenLink[] {
	const broken: BrokenLink[] = [];
	let fence: string | null = null;

	for (const [index, line] of text.split(/\r?\n/u).entries()) {
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

		const cleaned = line.replace(/`[^`]*`/gu, "");
		const targets = [
			...cleaned.matchAll(/(?<!!)\[[^\]]*\]\((?<target>[^)\s]+)(?:\s+"[^"]*")?\)/gu),
			...cleaned.matchAll(/\bhref="(?<href>[^"]+)"/gu),
		].map((match) => match[1]).filter((target): target is string => Boolean(target));

		for (const rawTarget of targets) {
			const target = rawTarget.trim().replace(/^<|>$/gu, "");
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
			if (base.startsWith("/api/") || base === "/api") {
				if (apiTargets === null) {
					continue;
				}
				const normalizedApi = base.replace(/\/+$/u, "").toLowerCase();
				if (!apiTargets.has(normalizedApi)) {
					broken.push({ file: fromFile, line: index + 1, target });
				}
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
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			collectMarkdown(entryPath, files);
		} else if (/\.(?:md|mdx)$/iu.test(entry.name)) {
			files.push(entryPath);
		}
	}
}

export function findBrokenDocLinks(root = process.cwd()): BrokenLink[] {
	const docsRoot = path.join(root, "docs/src/content/docs");
	const apiTargets = collectApiTargets(docsRoot);
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
		broken.push(...scanMarkdown(text, filePath, docsRoot, apiTargets));
	}
	return broken;
}

function resolveDistUrlPath(distRoot: string, rawUrl: string): boolean {
	let pathname: string;
	try {
		({ pathname } = new URL(rawUrl, "https://pplnd.dev"));
	} catch {
		return false;
	}
	const trimmed = pathname.replace(/^\/+|\/+$/gu, "");
	if (!trimmed) {
		return isFile(path.join(distRoot, "index.html"));
	}
	return isFile(path.join(distRoot, trimmed)) || isFile(path.join(distRoot, trimmed, "index.html"));
}

function findMissingBuiltArtifacts(root = process.cwd()): string[] {
	const issues: string[] = [];
	const distRoot = path.join(root, "docs/dist");
	if (!fs.existsSync(distRoot)) {
		return ["docs/dist directory missing; run pnpm docs:build first"];
	}

	const requiredDistFiles = [
		"index.html",
		"404.html",
		"favicon.svg",
		"sitemap-index.xml",
		"sitemap-0.xml",
		"search-index.json",
		"typedoc.json",
		"api/index.html",
		"robots.txt",
		".well-known/api-catalog",
	];
	for (const rel of requiredDistFiles) {
		if (!isFile(path.join(distRoot, rel))) {
			issues.push(`missing built artifact: docs/dist/${rel}`);
		}
	}

	const robotsPath = path.join(distRoot, "robots.txt");
	if (isFile(robotsPath)) {
		const robots = fs.readFileSync(robotsPath, "utf8");
		for (const match of robots.matchAll(/^Sitemap:\s*(?<sitemapUrl>.+)$/gmu)) {
			const sitemapUrl = match.groups!.sitemapUrl!.trim();
			if (!resolveDistUrlPath(distRoot, sitemapUrl)) {
				issues.push(`robots.txt sitemap target missing in dist: ${sitemapUrl}`);
			}
		}
	}

	const catalogPath = path.join(distRoot, ".well-known/api-catalog");
	if (isFile(catalogPath)) {
		try {
			const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as {
				linkset?: Array<Record<string, { href?: string; } | unknown>>;
			};
			for (const entry of catalog.linkset ?? []) {
				for (const relKey of ["service-desc", "service-doc"]) {
					const val = entry[relKey] as { href?: string; } | undefined;
					if (val?.href && !resolveDistUrlPath(distRoot, val.href)) {
						issues.push(`api-catalog ${relKey} target missing in dist: ${val.href}`);
					}
				}
			}
		} catch (error) {
			issues.push(`invalid .well-known/api-catalog JSON: ${String(error)}`);
		}
	}

	for (const htmlRel of ["index.html", "guides/result/index.html"]) {
		const htmlPath = path.join(distRoot, htmlRel);
		if (isFile(htmlPath)) {
			const html = fs.readFileSync(htmlPath, "utf8");
			if (!html.includes('rel="canonical"')) {
				issues.push(`missing rel="canonical" in docs/dist/${htmlRel}`);
			}
			if (!html.includes('property="og:title"')) {
				issues.push(`missing property="og:title" in docs/dist/${htmlRel}`);
			}
		}
	}

	for (const htmlRel of ["index.html", ...fs.globSync("guides/**/index.html", { cwd: distRoot })]) {
		const htmlPath = path.join(distRoot, htmlRel);
		if (!isFile(htmlPath)) {
			continue;
		}
		const html = fs.readFileSync(htmlPath, "utf8");
		const image = html.match(/<meta property="og:image" content="(?<url>https:\/\/[^"\s]+)"/u)?.groups?.url;
		const imagePath = htmlRel === "index.html"
			? "/social/home.png"
			: `/social/${htmlRel.replaceAll(path.sep, "/").slice(0, -"/index.html".length)}.png`;
		if (!image || !URL.canParse(image) || new URL(image).pathname !== imagePath) {
			issues.push(`missing absolute social image URL in docs/dist/${htmlRel}`);
			continue;
		}
		if (
			!html.includes('<meta name="twitter:card" content="summary_large_image"')
			|| !html.includes(`<meta name="twitter:image" content="${image}"`)
		) {
			issues.push(`missing large-image card metadata in docs/dist/${htmlRel}`);
		}
		const imageFile = path.join(distRoot, imagePath.slice(1));
		if (!isFile(imageFile)) {
			issues.push(`missing social image: docs/dist${imagePath}`);
			continue;
		}
		const png = fs.readFileSync(imageFile);
		if (
			png.length < 24 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
			|| !html.includes(`<meta property="og:image:width" content="${png.readUInt32BE(16)}"`)
			|| !html.includes(`<meta property="og:image:height" content="${png.readUInt32BE(20)}"`)
		) {
			issues.push(`social image must be a PNG with dimensions matching the metadata: docs/dist${imagePath}`);
		}
	}

	return issues;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const postBuild = process.argv.includes("--post-build");
	const broken = findBrokenDocLinks();
	const artifactIssues = postBuild ? findMissingBuiltArtifacts() : [];

	if (broken.length === 0 && artifactIssues.length === 0) {
		console.log(postBuild ? "Doc links and built artifacts: 0 issues." : "Doc links: 0 broken.");
	} else {
		for (const link of broken) {
			console.error(`${path.relative(process.cwd(), link.file)}:${link.line} -> ${link.target}`);
		}
		for (const issue of artifactIssues) {
			console.error(issue);
		}
		if (broken.length > 0) {
			console.error(`Doc links: ${broken.length} broken.`);
		}
		process.exitCode = 1;
	}
}
