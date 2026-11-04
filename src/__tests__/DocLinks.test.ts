import path from "node:path";
import { expect, test } from "vitest";
import { findBrokenDocLinks, scanMarkdown } from "../../scripts/check-doc-links.ts";

const projectRoot = path.resolve(__dirname, "../../");
const docsRoot = path.join(projectRoot, "docs/src/content/docs");
const fence = String.fromCharCode(96, 96, 96);
const tick = String.fromCharCode(96);

test("DocLinks: resolves absolute guide links with trailing slashes", () => {
	const source = path.join(docsRoot, "contributing/index.md");
	const text = "[Result](/guides/result/) and [choosing](/basics/choosing/)";
	expect(scanMarkdown(text, source, docsRoot)).toStrictEqual([]);
});

test("DocLinks: ignores external links, anchors, inline code, and fenced code", () => {
	const source = path.join(docsRoot, "contributing/index.md");
	const text = [
		"[external](https://example.com) [anchor](#section) [mail](mailto:test@example.com)",
		`${tick}[inline](/guides/missing/)${tick}`,
		`${fence}ts`,
		"[fenced](/guides/missing/)",
		fence,
	].join("\n");
	expect(scanMarkdown(text, source, docsRoot)).toStrictEqual([]);
});

test("DocLinks: reports a missing local target", () => {
	const source = path.join(docsRoot, "contributing/index.md");
	const broken = scanMarkdown("[missing](/guides/does-not-exist/)", source, docsRoot);
	expect(broken.map((link) => link.target)).toStrictEqual(["/guides/does-not-exist/"]);
});

test("DocLinks: the repository has no broken documentation links", () => {
	expect(findBrokenDocLinks(projectRoot)).toStrictEqual([]);
});
