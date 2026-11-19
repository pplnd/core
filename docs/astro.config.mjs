// @ts-check
import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import { pplndCodeTheme } from "./src/codeTheme.ts";

export default defineConfig({
	site: "https://pplnd.dev",
	integrations: [mdx(), {
		name: "css-module-class-names",
		hooks: {
			"astro:config:setup": ({ command, updateConfig }) => {
				const generateScopedName = command === "build" ? "_[hash:base64:4]" : "[name]__[local]";
				updateConfig({ vite: { css: { modules: { generateScopedName } } } });
			},
		},
	}],
	markdown: { shikiConfig: { theme: pplndCodeTheme } },
});
