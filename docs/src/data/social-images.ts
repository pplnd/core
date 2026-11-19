export const GUIDE_IMAGE_WIDTH = 1200;
export const GUIDE_IMAGE_HEIGHT = 630;

export interface SocialImage {
	readonly path: string;
	readonly alt: string;
	readonly width: number;
	readonly height: number;
}

export function guideSocialImage(slug: string, title: string): SocialImage | undefined {
	if (!slug.startsWith("guides/")) {
		return undefined;
	}
	return {
		path: `/social/${slug}.png`,
		alt: `${title}. Illustrated with the pipelined logo.`,
		width: GUIDE_IMAGE_WIDTH,
		height: GUIDE_IMAGE_HEIGHT,
	};
}
