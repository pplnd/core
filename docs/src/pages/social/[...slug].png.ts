import { Resvg } from "@resvg/resvg-js";
import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import { createRequire } from "node:module";
import logo from "../../../public/logo.svg?raw";
import { HOME_SOCIAL_CARD, SOCIAL_IMAGE_HEIGHT, SOCIAL_IMAGE_WIDTH } from "../../data/social-images";
import { GUIDE_FIGURES } from "../../figures";

const require = createRequire(import.meta.url);
const fontFiles = [
	require.resolve("@expo-google-fonts/inter-tight/400Regular/InterTight_400Regular.ttf"),
	require.resolve("@expo-google-fonts/inter-tight/500Medium/InterTight_500Medium.ttf"),
];
const logoUrl = `data:image/svg+xml;base64,${Buffer.from(logo).toString("base64")}`;

export const getStaticPaths = (async () => {
	const entries = await getCollection("docs", ({ id }) => id.startsWith("guides/"));
	const guides = entries.map(({ id, data }) => {
		const [heading = "", subtitle] = (data.title ?? id.slice("guides/".length)).split(" — ", 2);
		return {
			params: { slug: id },
			props: { heading, subtitle: subtitle ?? data.description, plate: GUIDE_FIGURES[id]?.plate },
		};
	});
	return [{
		params: { slug: "home" },
		props: { heading: HOME_SOCIAL_CARD.heading, subtitle: HOME_SOCIAL_CARD.subtitle },
	}, ...guides];
}) satisfies GetStaticPaths;

function escapeXml(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function wrapText(text: string, charactersPerLine: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.trim().split(/\s+/u)) {
		if (line && line.length + word.length + 1 > charactersPerLine) {
			lines.push(line);
			line = "";
		}
		line = line ? `${line} ${word}` : word;
	}
	if (line) {
		lines.push(line);
	}
	return lines;
}

function renderLines(lines: string[], baseline: number, lineHeight: number): string {
	return lines.map((line, index) => `<text x="96" y="${baseline + index * lineHeight}">${escapeXml(line)}</text>`).join(
		"",
	);
}

export const GET: APIRoute<{ heading: string; subtitle?: string; plate?: string; }> = (
	{ props: { heading, subtitle = "", plate = "#ffffff" } },
) => {
	const headingLines = wrapText(heading, 16);
	const subtitleLines = wrapText(subtitle, 27);
	const fontSize = Math.min(94, 880 / Math.max(1, ...headingLines.map((line) => line.length)));
	const headingStep = fontSize * 1.05;
	const subtitleStep = 42;
	const headingHeight = headingStep * headingLines.length;
	const subtitleHeight = subtitleLines.length > 0 ? 16 + subtitleStep * subtitleLines.length : 0;
	const titleTop = (SOCIAL_IMAGE_HEIGHT - headingHeight - subtitleHeight) / 2;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SOCIAL_IMAGE_WIDTH}" height="${SOCIAL_IMAGE_HEIGHT}">
		<rect width="100%" height="100%" fill="${plate}" />
		<image x="624" y="0" width="480" height="${SOCIAL_IMAGE_HEIGHT}" href="${logoUrl}" />
		<g font-family="Inter Tight" fill="#231f20">
			<g font-size="${fontSize}" font-weight="500">
				${renderLines(headingLines, titleTop + fontSize * 0.85, headingStep)}
			</g>
			<g font-size="36">
				${renderLines(subtitleLines, titleTop + headingHeight + 44, subtitleStep)}
			</g>
		</g>
	</svg>`;
	const png = new Resvg(svg, { font: { fontFiles, loadSystemFonts: false } }).render().asPng();
	return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
};
