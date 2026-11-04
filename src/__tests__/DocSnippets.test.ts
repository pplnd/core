import { expect, test } from "vitest";
import { extractCheckSnippets } from "../../scripts/check-doc-snippets.ts";

const fence = String.fromCharCode(96, 96, 96);

test("DocSnippets: extracts only ts check fences", () => {
	const markdown = [`${fence}ts check`, "const value: number = 1;", fence, "", `${fence}ts`, "const ignored = 2;", fence]
		.join("\n");
	const snippets = extractCheckSnippets(markdown, "README.md");
	expect(snippets).toHaveLength(1);
	expect(snippets[0]!.code).toBe("const value: number = 1;");
	expect(snippets[0]!.line).toBe(2);
});
