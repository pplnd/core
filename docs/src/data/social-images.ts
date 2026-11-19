export const SOCIAL_IMAGE_WIDTH = 1200;
export const SOCIAL_IMAGE_HEIGHT = 630;

export interface SocialImage {
	readonly path: string;
	readonly alt: string;
	readonly width: number;
	readonly height: number;
}

const homeHeading = "pipelined";
const homeSubtitle = "Typed errors, explicit absence, composable async.";

export const HOME_SOCIAL_CARD = {
	heading: homeHeading,
	subtitle: homeSubtitle,
	image: {
		path: "/social/home.png",
		alt: `${homeHeading}. ${homeSubtitle} Illustrated with the pipelined logo.`,
		width: SOCIAL_IMAGE_WIDTH,
		height: SOCIAL_IMAGE_HEIGHT,
	},
};

export function guideSocialImage(slug: string, title: string): SocialImage | undefined {
	if (!slug.startsWith("guides/")) {
		return undefined;
	}
	return {
		path: `/social/${slug}.png`,
		alt: `${title}. Illustrated with the pipelined logo.`,
		width: SOCIAL_IMAGE_WIDTH,
		height: SOCIAL_IMAGE_HEIGHT,
	};
}
