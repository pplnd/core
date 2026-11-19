import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { defineCollection } from "astro:content";

export const collections = {
	docs: defineCollection({
		loader: glob({
			pattern: "**/*.{md,mdx}",
			base: "./src/content/docs",
			generateId: ({ entry }) =>
				entry.replace(/\.(?:md|mdx)$/iu, "").replace(/(?:^|\/)index$/iu, (match) => (match.startsWith("/") ? "/" : ""))
					.replace(/\/$/u, "").toLowerCase(),
		}),
		schema: z.looseObject({
			title: z.string().optional(),
			description: z.string().optional(),
			author: z.string().optional(),
		}),
	}),
};
