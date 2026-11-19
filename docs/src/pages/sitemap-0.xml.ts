import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

function escapeXml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

export const GET: APIRoute = async ({ site }) => {
	const base = (site ?? new URL("https://pplnd.dev")).href.replace(/\/$/u, "");
	const entries = await getCollection("docs");
	const paths = ["/", ...entries.map((entry) => `/${entry.id}/`).sort()];
	const urls = paths.map((route) => `  <url>\n    <loc>${escapeXml(`${base}${route}`)}</loc>\n  </url>`).join("\n");
	const body =
		`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
	return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
