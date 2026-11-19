import type { AstroUserConfig } from "astro";

type ShikiTheme = Exclude<
	NonNullable<NonNullable<NonNullable<AstroUserConfig["markdown"]>["shikiConfig"]>["theme"]>,
	string
>;

export const pplndCodeTheme: ShikiTheme = {
	name: "pplnd-code",
	type: "light",
	colors: { "editor.foreground": "var(--pplnd-code-fg)", "editor.background": "var(--pplnd-code-bg)" },
	tokenColors: [{
		scope: ["comment", "punctuation.definition.comment", "string.quoted.docstring.multi"],
		settings: { foreground: "var(--pplnd-code-comment)" },
	}, {
		scope: ["punctuation", "meta.brace", "keyword.operator", "storage.type.function.arrow"],
		settings: { foreground: "var(--pplnd-code-punct)" },
	}, {
		scope: [
			"keyword",
			"storage.type",
			"storage.modifier",
			"keyword.control",
			"keyword.operator.new",
			"keyword.operator.expression",
			"keyword.operator.logical",
		],
		settings: { foreground: "var(--pplnd-code-keyword)" },
	}, {
		scope: [
			"entity.name.type",
			"entity.other.inherited-class",
			"support.type",
			"support.class",
			"variable.other.object",
			"entity.name.namespace",
			"storage.type.built-in",
			"storage.type.primitive",
		],
		settings: { foreground: "var(--pplnd-code-type)" },
	}, {
		scope: ["entity.name.function", "support.function", "meta.function-call entity.name.function", "variable.function"],
		settings: { foreground: "var(--pplnd-code-function)" },
	}, {
		scope: [
			"string",
			"string.quoted",
			"string.template",
			"string.regexp",
			"punctuation.definition.string",
			"support.type.property-name.json",
		],
		settings: { foreground: "var(--pplnd-code-string)" },
	}, {
		scope: [
			"constant",
			"constant.numeric",
			"constant.language",
			"constant.character",
			"variable.language.this",
			"variable.other.constant",
			"support.constant",
		],
		settings: { foreground: "var(--pplnd-code-constant)" },
	}, {
		scope: [
			"variable",
			"variable.parameter",
			"variable.other.readwrite",
			"variable.other.property",
			"meta.object-literal.key",
			"meta.definition.variable",
		],
		settings: { foreground: "var(--pplnd-code-fg)" },
	}, {
		scope: ["markup.inserted", "punctuation.definition.inserted"],
		settings: { foreground: "var(--pplnd-code-function)" },
	}, {
		scope: ["markup.deleted", "punctuation.definition.deleted"],
		settings: { foreground: "var(--pplnd-code-string)" },
	}],
};
