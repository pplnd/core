import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
		typecheck: { include: ["src/**/*.test-d.ts"] },
		coverage: {
			provider: "v8",
			reporter: ["lcov", "text", "html"],
			include: ["src/**/*.ts", "src/**/*.tsx"],
			exclude: ["src/index.ts", "src/**/__tests__/**"],
		},
	},
});
