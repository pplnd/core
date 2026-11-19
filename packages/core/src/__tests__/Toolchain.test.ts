import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

// mise.toml is the single source of truth for the development toolchain;
// `packageManager` in package.json is derived from it (pnpm toolchain:update).
const projectRoot = path.resolve(__dirname, "../../../../");

test("Toolchain: packageManager matches the pnpm version pinned in mise.toml", () => {
	const mise = fs.readFileSync(path.join(projectRoot, "mise.toml"), "utf8");
	const pinned = /^pnpm\s*=\s*"(?<version>[^"]+)"/mu.exec(mise)?.groups?.version;
	expect(pinned).toBeDefined();

	const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
		packageManager?: string;
	};

	expect(pkg.packageManager).toBe(`pnpm@${pinned}`);
});
