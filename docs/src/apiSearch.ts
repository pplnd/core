import fs from "node:fs";
import path from "node:path";
import { SEARCH_ITEMS, type SearchEntry } from "./nav";

function resolveApiRoot(): string | null {
	const candidates = [
		path.resolve(process.cwd(), "src/content/docs/api"),
		path.resolve(process.cwd(), "docs/src/content/docs/api"),
		path.resolve(import.meta.dirname, "content/docs/api"),
	];
	return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

const SKIP_HEADINGS = new Set([
	"Type Parameters",
	"Parameters",
	"Returns",
	"See",
	"Example",
	"Call Signature",
	"Type Declaration",
	"Remarks",
	"Throws",
	"Indexable",
	"Properties",
]);

function slugifyHeading(text: string): string {
	return text.toLowerCase().replace(/\\\[|\\\]/gu, "").replace(/[^a-z0-9 _-]/gu, "").trim().replace(/\s+/gu, "-")
		.replace(/-+/gu, "-");
}

function nextAnchor(rawHeading: string, counts: Map<string, number>): string {
	const base = slugifyHeading(rawHeading);
	const seen = counts.get(base) ?? 0;
	counts.set(base, seen + 1);
	return seen === 0 ? base : `${base}-${seen}`;
}

function firstSummaryLine(lines: readonly string[], startIdx: number): string {
	const limit = Math.min(lines.length, startIdx + 18);
	for (let i = startIdx; i < limit; i++) {
		const line = lines[i]!.trim();
		if (
			!line
			|| line.startsWith(">")
			|| line.startsWith("#")
			|| line.startsWith("Defined in:")
			|| line.startsWith("```")
			|| line === "***"
		) {
			continue;
		}
		return line.replace(/\[(?<label>[^\]]+)\]\([^)]+\)/gu, "$<label>").replace(/`/gu, "").replace(
			/\\(?<escaped>[<>|[\]])/gu,
			"$<escaped>",
		);
	}
	return "";
}

function collectTypeAliasProperties(
	lines: readonly string[],
	prefix: string,
	baseHref: string,
	metaLabel: string,
	out: SearchEntry[],
): void {
	let inProps = false;
	const counts = new Map<string, number>();

	for (let i = 0; i < lines.length; i++) {
		const m = lines[i]!.match(/^(?<hashes>#{2,6})\s+(?<heading>.+)$/u);
		if (!m) {
			continue;
		}
		const level = m.groups!.hashes!.length;
		const rawHeading = m.groups!.heading!.trim();
		const anchor = nextAnchor(rawHeading, counts);

		if (level === 2) {
			inProps = rawHeading === "Properties" || rawHeading === "Type Declaration";
			continue;
		}
		if (!inProps || level !== 3 || rawHeading.startsWith("\\[")) {
			continue;
		}

		const cleanName = rawHeading.replace(/\\\?/gu, "?").replace(/\?$/u, "");
		out.push({
			label: `${prefix}.${cleanName}`,
			href: `${baseHref}#${anchor}`,
			section: "API Reference",
			meta: metaLabel,
			desc: firstSummaryLine(lines, i + 1),
		});
	}
}

export function getApiSearchEntries(): SearchEntry[] {
	const apiRoot = resolveApiRoot();
	if (!apiRoot) {
		return [];
	}
	const entries: SearchEntry[] = [];

	const fnDir = path.join(apiRoot, "functions");
	if (fs.existsSync(fnDir)) {
		for (const file of fs.readdirSync(fnDir).sort()) {
			if (!file.endsWith(".md")) {
				continue;
			}
			const name = path.basename(file, ".md");
			const lines = fs.readFileSync(path.join(fnDir, file), "utf8").split(/\r?\n/u);
			entries.push({
				label: `${name}()`,
				href: `/api/functions/${name.toLowerCase()}/`,
				section: "API Reference",
				meta: "API · Function",
				desc: firstSummaryLine(lines, 0),
			});
		}
	}

	const typeDir = path.join(apiRoot, "type-aliases");
	if (fs.existsSync(typeDir)) {
		for (const file of fs.readdirSync(typeDir).sort()) {
			if (!file.endsWith(".md")) {
				continue;
			}
			const name = path.basename(file, ".md");
			const baseHref = `/api/type-aliases/${name.toLowerCase()}/`;
			const lines = fs.readFileSync(path.join(typeDir, file), "utf8").split(/\r?\n/u);
			entries.push({
				label: `type ${name}`,
				href: baseHref,
				section: "API Reference",
				meta: "API · Type",
				desc: firstSummaryLine(lines, 0),
			});
			collectTypeAliasProperties(lines, name, baseHref, `API · ${name}`, entries);
		}
	}

	const nsRoot = path.join(apiRoot, "core/namespaces");
	if (fs.existsSync(nsRoot)) {
		for (const ns of fs.readdirSync(nsRoot).sort()) {
			const nsHref = `/api/core/namespaces/${ns.toLowerCase()}/readme/`;
			const readmePath = path.join(nsRoot, ns, "README.md");
			if (fs.existsSync(readmePath)) {
				const lines = fs.readFileSync(readmePath, "utf8").split(/\r?\n/u);
				entries.push({
					label: `${ns} namespace`,
					href: nsHref,
					section: "API Reference",
					meta: "API · Namespace",
					desc: firstSummaryLine(lines, 0) || `Types under ${ns}`,
				});
			}

			const taDir = path.join(nsRoot, ns, "type-aliases");
			if (!fs.existsSync(taDir)) {
				continue;
			}
			for (const file of fs.readdirSync(taDir).sort()) {
				if (!file.endsWith(".md")) {
					continue;
				}
				const name = path.basename(file, ".md");
				const baseHref = `/api/core/namespaces/${ns.toLowerCase()}/type-aliases/${name.toLowerCase()}/`;
				const lines = fs.readFileSync(path.join(taDir, file), "utf8").split(/\r?\n/u);
				entries.push({
					label: `${ns}.${name}`,
					href: baseHref,
					section: "API Reference",
					meta: "API · Type",
					desc: firstSummaryLine(lines, 0),
				});
				collectTypeAliasProperties(lines, `${ns}.${name}`, baseHref, `API · ${ns}.${name}`, entries);
			}
		}
	}

	const varDir = path.join(apiRoot, "variables");
	if (fs.existsSync(varDir)) {
		for (const file of fs.readdirSync(varDir).sort()) {
			if (!file.endsWith(".md")) {
				continue;
			}
			const mod = path.basename(file, ".md");
			const baseHref = `/api/variables/${mod.toLowerCase()}/`;
			const lines = fs.readFileSync(path.join(varDir, file), "utf8").split(/\r?\n/u);

			entries.push({
				label: mod,
				href: baseHref,
				section: "API Reference",
				meta: "API · Module",
				desc: firstSummaryLine(lines, 0) || `${mod} API reference`,
			});

			const counts = new Map<string, number>();
			for (let i = 0; i < lines.length; i++) {
				const m = lines[i]!.match(/^(?<hashes>#{2,6})\s+(?<heading>.+)$/u);
				if (!m) {
					continue;
				}
				const level = m.groups!.hashes!.length;
				const rawHeading = m.groups!.heading!.trim();
				const anchor = nextAnchor(rawHeading, counts);

				if (SKIP_HEADINGS.has(rawHeading)) {
					continue;
				}
				if (level === 3 || (level === 4 && rawHeading.includes("."))) {
					const cleanMember = rawHeading.replace(/\\\?/gu, "?").replace(/\?$/u, "");
					entries.push({
						label: `${mod}.${cleanMember}`,
						href: `${baseHref}#${anchor}`,
						section: "API Reference",
						meta: `API · ${mod}`,
						desc: firstSummaryLine(lines, i + 1),
					});
				}
			}
		}
	}

	return entries;
}

export function getAllSearchItems(): SearchEntry[] {
	return [...SEARCH_ITEMS, ...getApiSearchEntries()];
}
