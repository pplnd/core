// @ts-check
import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import { pplndCodeTheme } from "./src/codeTheme.ts";

export default defineConfig({
	site: "https://pplnd.dev",
	integrations: [mdx()],
	markdown: { shikiConfig: { theme: pplndCodeTheme } },
});
