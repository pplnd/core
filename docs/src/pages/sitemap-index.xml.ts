import type { APIRoute } from "astro";

function escapeXml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

export const GET: APIRoute = ({ site }) => {
	const base = (site ?? new URL("https://pplnd.dev")).href.replace(/\/$/u, "");
	const body =
		`<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <sitemap>\n    <loc>${
			escapeXml(`${base}/sitemap-0.xml`)
		}</loc>\n  </sitemap>\n</sitemapindex>\n`;
	return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
