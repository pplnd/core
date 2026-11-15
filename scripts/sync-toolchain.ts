import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// mise.toml is the single source of truth for the development toolchain. This
// script derives `packageManager` in package.json from the pnpm pin, so a
// toolchain bump touches mise.toml only. Toolchain.test.ts fails on drift;
// run this script to restamp.
const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");

const mise = fs.readFileSync(path.join(projectRoot, "mise.toml"), "utf8");
// The only [tools] section in mise.toml carries the pnpm pin.
const pnpmVersion = /^pnpm\s*=\s*"(?<version>[^"]+)"/mu.exec(mise)?.groups?.version;
if (pnpmVersion === undefined) {
	throw new Error('mise.toml does not pin a pnpm version (expected `pnpm = "x.y.z"` under [tools])');
}

const packageJsonPath = path.join(projectRoot, "package.json");
const packageJson = fs.readFileSync(packageJsonPath, "utf8");
const expected = `"packageManager": "pnpm@${pnpmVersion}"`;

if (packageJson.includes(expected)) {
	console.log(`Toolchain: packageManager already pins pnpm@${pnpmVersion}.`);
	if (process.argv.includes("--check")) {
		process.exitCode = 0;
	}
} else if (!/"packageManager":\s*"pnpm@[^"]*"/u.test(packageJson)) {
	throw new Error(`package.json has no packageManager field to restamp; add ${expected} manually.`);
} else if (process.argv.includes("--check")) {
	console.error(`Toolchain drift: package.json pins a different pnpm than mise.toml (${pnpmVersion}).`);
	console.error("Run `pnpm toolchain:update` to restamp packageManager from mise.toml.");
	process.exitCode = 1;
} else {
	fs.writeFileSync(packageJsonPath, packageJson.replace(/"packageManager":\s*"pnpm@[^"]*"/u, expected), "utf8");
	console.log(`Toolchain: packageManager restamped to pnpm@${pnpmVersion}.`);
}
