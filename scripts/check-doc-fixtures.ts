import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Recipes are real user scenarios, so each one is kept as a compiled fixture in
// scripts/doc-fixtures/. This script asserts every ```ts block in the recipe's
// markdown appears verbatim in the fixture (imports and blank lines excepted)
// and type-checks the fixtures against the library source.
const RECIPES: ReadonlyArray<{ readonly fixture: string; readonly docs: string; }> = [
	{ fixture: "quickstart.ts", docs: "docs/src/content/docs/basics/quickstart.mdx" },
	{ fixture: "dependency-graph.ts", docs: "docs/src/content/docs/recipes/dependency-graph.md" },
	{ fixture: "events-and-state.ts", docs: "docs/src/content/docs/recipes/events-and-state.md" },
	{ fixture: "field-validation.ts", docs: "docs/src/content/docs/recipes/field-validation.md" },
	{ fixture: "request-lifecycle.ts", docs: "docs/src/content/docs/recipes/request-lifecycle.md" },
];

const FENCE_START = /^\s*`{3}\s*ts(?:\s+\S+)?\s*$/u;

function extractTsBlocks(markdown: string, source: string): Array<{ readonly line: number; readonly code: string; }> {
	const blocks: Array<{ readonly line: number; readonly code: string; }> = [];
	const lines = markdown.split(/\r?\n/u);
	let inFence = false;
	let startLine = 0;
	let buffer: string[] = [];
	for (const [index, line] of lines.entries()) {
		if (!inFence) {
			if (FENCE_START.test(line)) {
				inFence = true;
				startLine = index + 2;
				buffer = [];
			}
			continue;
		}
		if (line.trim().startsWith("```")) {
			blocks.push({ line: startLine, code: buffer.join("\n") });
			inFence = false;
			buffer = [];
			continue;
		}
		buffer.push(line);
	}
	if (inFence) {
		throw new Error(`Unterminated ts fence in ${source}`);
	}
	return blocks;
}

// Code appears in a recipe's markdown fence and in the fixture with independent
// line wrapping and indentation, so matching collapses whitespace runs entirely:
// the check is about the token stream, not the layout. The block is first
// formatted with the repo's TypeScript dprint config, because the markdown
// formatter styles fence contents differently from the TypeScript formatter.
function formatBlock(root: string, code: string): string {
	const dprintBin = path.join(root, "node_modules/.bin/dprint");
	return execFileSync(dprintBin, ["fmt", "--stdin", "recipe-block.ts"], {
		input: code,
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	});
}

function normalize(text: string): string {
	// The markdown and TypeScript dprint configs disagree on semicolons in
	// single-line type members; semicolons carry no matching information.
	return text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0).filter((line) =>
		!line.startsWith("import ") && !/^export \{/u.test(line)
	).map((line) => line.replace(/^export (?=(?:const|type|function)\b)/u, "")).join(" ").replace(/\s+/gu, " ").replace(
		/,\s*\)/gu,
		")",
	) // trailing commas: the ts config preserves them, the md config strips them
		.replace(/\(\s+/gu, "(").replace(/\s+\)/gu, ")") // multi-line call formatting vs single-line
		.replaceAll(";", "");
}

function checkFenceMatch(root: string): number {
	let matched = 0;
	for (const recipe of RECIPES) {
		const docsPath = path.join(root, recipe.docs);
		const fixturePath = path.join(root, "scripts/doc-fixtures", recipe.fixture);
		const fixtureBody = normalize(fs.readFileSync(fixturePath, "utf8"));
		const blocks = extractTsBlocks(fs.readFileSync(docsPath, "utf8"), recipe.docs);
		for (const block of blocks) {
			const body = normalize(formatBlock(root, block.code));
			if (body.length === 0 || fixtureBody.includes(body)) {
				matched += 1;
				continue;
			}
			const snippetHead = body.slice(0, 120);
			throw new Error(
				`Recipe block not found in fixture ${recipe.fixture} (${recipe.docs}:${block.line}):\n  ${snippetHead}`,
			);
		}
	}
	return matched;
}

function compileFixtures(root: string): void {
	const fixtureDirectory = path.join(root, "scripts/doc-fixtures");
	const files = RECIPES.map((recipe) => path.relative(root, path.join(fixtureDirectory, recipe.fixture)));

	// The temp tsconfig lives at the repo root: TS resolves `include`, `paths`, and
	// `typeRoots` relative to the config file's own location, and non-relative
	// path values are rejected (TS5090).
	const toConfigPath = (absolute: string): string => {
		const relative = path.relative(root, absolute).split(path.sep).join("/");
		return relative.startsWith("..") ? relative : `./${relative}`;
	};

	const tsconfig = {
		compilerOptions: {
			allowImportingTsExtensions: true,
			lib: ["ESNext", "DOM"],
			module: "ESNext",
			moduleResolution: "bundler",
			noEmit: true,
			paths: { "@pplnd/core": [toConfigPath(path.join(root, "packages/core/src/index.ts"))] },
			skipLibCheck: true,
			strict: true,
			target: "ES2022",
			typeRoots: [toConfigPath(path.join(root, "node_modules/@types"))],
			types: ["node"],
		},
		include: files,
	};
	const configPath = path.join(root, "tsconfig.doc-fixtures.check.json");
	fs.writeFileSync(configPath, JSON.stringify(tsconfig, null, 2), "utf8");
	try {
		const tsc = path.join(root, "node_modules/typescript/bin/tsc");
		execFileSync(process.execPath, [tsc, "-p", configPath], { cwd: root, encoding: "utf8", stdio: "pipe" });
	} catch (error) {
		const failure = error as { stdout?: string; stderr?: string; message?: string; };
		const output = [failure.stdout, failure.stderr, failure.message].filter(Boolean).join("\n");
		throw new Error(`Recipe fixtures failed to compile:\n${output}`, { cause: error });
	} finally {
		fs.rmSync(configPath, { force: true });
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const root = process.cwd();
	try {
		const matched = checkFenceMatch(root);
		compileFixtures(root);
		console.log(`Doc fixtures: ${RECIPES.length} compiled, ${matched} recipe blocks matched.`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
