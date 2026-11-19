import { ASYNC_ENGINE_FIGURES } from "./asyncEngines";
import { DATA_AND_TYPE_FIGURES } from "./dataAndTypes";
import { ERRORS_AND_STATE_FIGURES } from "./errorsAndState";
import { REACT_AND_RECIPE_FIGURES } from "./reactAndRecipes";
import type { HeroFigureSpec } from "./types";

export const GUIDE_FIGURES: Readonly<Partial<Record<string, HeroFigureSpec>>> = {
	...ERRORS_AND_STATE_FIGURES,
	...ASYNC_ENGINE_FIGURES,
	...DATA_AND_TYPE_FIGURES,
	...REACT_AND_RECIPE_FIGURES,
};
