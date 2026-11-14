import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export interface DocSnippet {
	readonly source: string;
	readonly line: number;
	readonly code: string;
}

const FENCE_START = /^\s*`{3}\s*(?<lang>\S+)(?:\s+(?<meta>\S+))?\s*$/u;

export function extractCheckSnippets(markdown: string, source: string): DocSnippet[] {
	const snippets: DocSnippet[] = [];
	const lines = markdown.split(/\r?\n/u);
	let fenceLanguage: string | null = null;
	let fenceMeta: string | null = null;
	let startLine = 0;
	let buffer: string[] = [];

	for (const [index, line] of lines.entries()) {
		if (fenceLanguage === null) {
			const match = line.match(FENCE_START);
			if (match) {
				fenceLanguage = match[1]!;
				fenceMeta = match[2] ?? null;
				startLine = index + 2;
				buffer = [];
			}
			continue;
		}

		if (line.trim().startsWith("```")) {
			if (fenceLanguage === "ts" && fenceMeta === "check") {
				snippets.push({ source, line: startLine, code: buffer.join("\n") });
			}
			fenceLanguage = null;
			fenceMeta = null;
			buffer = [];
			continue;
		}

		buffer.push(line);
	}

	return snippets;
}

function collectMarkdown(directory: string, files: string[]): void {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			collectMarkdown(entryPath, files);
		} else if (/\.mdx?$/iu.test(entry.name)) {
			files.push(entryPath);
		}
	}
}

export function findCheckSnippets(root = process.cwd()): DocSnippet[] {
	const files = [path.join(root, "README.md")];
	collectMarkdown(path.join(root, "docs/src/content/docs/contributing"), files);
	return files.flatMap((file) => fs.existsSync(file) ? extractCheckSnippets(fs.readFileSync(file, "utf8"), file) : []);
}

export function compileSnippets(root: string, snippets: DocSnippet[]): void {
	if (snippets.length === 0) {
		return;
	}
	const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pipelined-doc-snippets-"));
	try {
		const files: string[] = [];
		for (const [index, snippet] of snippets.entries()) {
			const fileName = `snippet-${String(index + 1).padStart(3, "0")}.ts`;
			const filePath = path.join(tempDirectory, fileName);
			const source = path.relative(root, snippet.source);
			fs.writeFileSync(filePath, `// ${source}:${snippet.line}\nexport {};\n${snippet.code}\n`, "utf8");
			files.push(fileName);
		}

		// TS 7 removed `baseUrl`: `paths` and `typeRoots` must be relative to the
		// tsconfig location (this temp directory). Relative paths resolve the same
		// way on TS >= 5, so no version branching is needed.
		const toConfigPath = (absolute: string): string => path.relative(tempDirectory, absolute).split(path.sep).join("/");

		const tsconfig = {
			compilerOptions: {
				allowImportingTsExtensions: true,
				lib: ["ESNext", "DOM"],
				module: "ESNext",
				moduleResolution: "bundler",
				noEmit: true,
				paths: { "@pplnd/core": [toConfigPath(path.join(root, "src/index.ts"))] },
				skipLibCheck: true,
				strict: true,
				target: "ES2022",
				typeRoots: [toConfigPath(path.join(root, "node_modules/@types"))],
				types: ["node"],
			},
			include: files,
		};
		const configPath = path.join(tempDirectory, "tsconfig.json");
		fs.writeFileSync(configPath, JSON.stringify(tsconfig, null, 2), "utf8");

		const tsc = path.join(root, "node_modules/typescript/bin/tsc");
		try {
			execFileSync(process.execPath, [tsc, "-p", configPath], { cwd: tempDirectory, encoding: "utf8", stdio: "pipe" });
		} catch (error) {
			const failure = error as { stdout?: string; stderr?: string; message?: string; };
			const output = [failure.stdout, failure.stderr, failure.message].filter(Boolean).join("\n");
			throw new Error(`Documentation snippets failed to compile:\n${output}`, { cause: error });
		}
	} finally {
		fs.rmSync(tempDirectory, { recursive: true, force: true });
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const snippets = findCheckSnippets();
	try {
		compileSnippets(process.cwd(), snippets);
		console.log(`Doc snippets: ${snippets.length} compiled.`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
