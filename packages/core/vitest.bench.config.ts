import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.ts";

export default mergeConfig(
	base,
	defineConfig({
		test: {
			// A five-way comparison takes ~85 s on the reference machine; the default
			// 60 s test timeout aborted `pnpm bench` during the 2026-11-05 audit.
			testTimeout: 600_000,
		},
	}),
);
