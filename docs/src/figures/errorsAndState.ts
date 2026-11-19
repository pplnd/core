import type { HeroFigureSpec } from "./types";

export const ERRORS_AND_STATE_FIGURES: Record<string, HeroFigureSpec> = {
	"basics/pipelines": {
		plate: "#e6dec8",
		title: "Linear transformation flow in pipe",
		desc:
			"A raw string enters pipe and passes left to right through trim, toLowerCase, and replace to produce a clean slug.",
		caption: "pipe · Top-to-bottom linear data flow",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M-8 128 H56 M184 128 H222 M350 128 H388 M516 128 H558" />
				<path d="M46 118 L56 128 L46 138 M212 118 L222 128 L212 138 M378 118 L388 128 L378 138 M548 118 L558 128 L548 138" />
				<rect x="56" y="88" width="128" height="80" class="flow-node" />
				<rect x="222" y="88" width="128" height="80" class="flow-node" />
				<rect x="388" y="88" width="128" height="80" class="flow-node" />
			</g>
			<text x="16" y="64" class="flow-value">"  New Release  "</text>
			<text x="120" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">trim</text>
			<text x="286" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">lower</text>
			<text x="452" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">replace</text>
			<text x="580" y="64" text-anchor="end" class="flow-value">"new-release"</text>
		`,
	},
	"basics/composition": {
		plate: "#dcefb8",
		title: "Conditional branching and struct shaping in pipelines",
		desc:
			"An input record enters when(isVip) or skips along a bypass rail, then feeds struct to derive multiple fields at once.",
		caption: "Composition · Guard steps with when and build records with struct",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M92 128 H134 M134 128 L170 82 H286 L322 128" />
				<path d="M134 128 L170 174 H286 L322 128" class="flow-dash" />
				<path d="M322 128 H378 M368 118 L378 128 L368 138" />
				<rect x="174" y="56" width="108" height="52" class="flow-node" />
				<rect x="378" y="64" width="184" height="128" class="flow-node" />
				<circle cx="134" cy="128" r="5" fill="currentColor" />
				<circle cx="322" cy="128" r="5" fill="currentColor" />
			</g>
			<text x="78" y="128" text-anchor="end" dominant-baseline="central" class="flow-value">user</text>
			<text x="228" y="82" text-anchor="middle" dominant-baseline="central" class="flow-value">when(vip)</text>
			<text x="228" y="200" text-anchor="middle" class="flow-tag">else keep</text>
			<text x="470" y="106" text-anchor="middle" dominant-baseline="central" class="flow-value">struct(&#123; ... &#125;)</text>
			<text x="470" y="146" text-anchor="middle" dominant-baseline="central" class="flow-tag">name, age, role</text>
		`,
	},
	"guides/result": {
		plate: "#c5daf6",
		title: "Parsing JSON with Result.tryCatch",
		desc: "Valid JSON becomes an Ok with the parsed value. A syntax error becomes an Err with INVALID_JSON.",
		caption: "Result.tryCatch · Parsing server configuration",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M-8 129 H189 L278 64 H341 M189 129 L278 192 H341" />
				<path d="M331 54 L341 64 L331 74 M331 182 L341 192 L331 202" />
				<circle cx="189" cy="129" r="5" fill="currentColor" />
			</g>
			<text x="25" y="114" class="flow-input">JSON.parse</text>
			<text x="360" y="76" class="flow-case">Ok</text>
			<text x="360" y="103" class="flow-value">parsed value</text>
			<text x="360" y="204" class="flow-case">Err</text>
			<text x="360" y="231" class="flow-value">INVALID_JSON</text>
		`,
	},
	"guides/maybe": {
		plate: "#b4dce2",
		title: "Presence and absence branching in Maybe",
		desc:
			"A nullable environment value enters Maybe.from.nullable and branches into Some when present or None when missing.",
		caption: "Maybe.from.nullable · Explicit presence without null or undefined",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M-8 129 H204 L288 64 H348 M204 129 L288 192 H348" />
				<path d="M338 54 L348 64 L338 74 M338 182 L348 192 L338 202" />
				<circle cx="204" cy="129" r="5" fill="currentColor" />
			</g>
			<text x="22" y="114" class="flow-input">QUEUE_URL</text>
			<text x="368" y="76" class="flow-case">Some</text>
			<text x="368" y="103" class="flow-value">value present</text>
			<text x="368" y="204" class="flow-case">None</text>
			<text x="368" y="231" class="flow-value">default fallback</text>
		`,
	},
	"guides/validation": {
		plate: "#f7d4bc",
		title: "Error accumulation across fields in Validation.struct",
		desc:
			"Three field checks run independently and join at Validation.struct to collect all failures instead of stopping at the first.",
		caption: "Validation.struct · Inspect every field and collect all errors",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M168 58 H254 L318 128 M168 128 H318 M168 198 H254 L318 128" />
				<path d="M318 128 L372 72 H406 M318 128 L372 184 H406" />
				<path d="M396 62 L406 72 L396 82 M396 174 L406 184 L396 194" />
				<circle cx="318" cy="128" r="5" fill="currentColor" />
			</g>
			<text x="154" y="58" text-anchor="end" dominant-baseline="central" class="flow-value">username ×</text>
			<text x="154" y="128" text-anchor="end" dominant-baseline="central" class="flow-value">email ✓</text>
			<text x="154" y="198" text-anchor="end" dominant-baseline="central" class="flow-value">password ×</text>
			<text x="414" y="84" class="flow-case">Passed</text>
			<text x="414" y="110" class="flow-value">valid form</text>
			<text x="414" y="196" class="flow-case">Failed</text>
			<text x="414" y="222" class="flow-value">[err1, err2]</text>
		`,
	},
	"guides/remote-data": {
		plate: "#bce5f5",
		title: "Four-state lifecycle in RemoteData",
		desc:
			"RemoteData moves from NotAsked through Loading and resolves into either Success with data or Failure with an error.",
		caption: "RemoteData · Four states, no impossible combinations",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M132 128 H192 M320 128 L374 72 H406 M320 128 L374 184 H406" />
				<path d="M182 118 L192 128 L182 138 M396 62 L406 72 L396 82 M396 174 L406 184 L396 194" />
				<circle cx="76" cy="128" r="56" class="flow-node" />
				<circle cx="256" cy="128" r="64" class="flow-node" />
			</g>
			<text x="76" y="128" text-anchor="middle" dominant-baseline="central" class="flow-label">NotAsked</text>
			<text x="256" y="128" text-anchor="middle" dominant-baseline="central" class="flow-label">Loading</text>
			<text x="420" y="78" class="flow-label">Success(data)</text>
			<text x="420" y="190" class="flow-label">Failure(error)</text>
		`,
	},
	"guides/these": {
		plate: "#f7dfa8",
		title: "Three variants of These: First, Second, Both",
		desc: "An operation can return a primary value only, a diagnostic warning only, or both together.",
		caption: "These · Primary value, diagnostic warning, or both",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M-8 128 H194 M194 128 L272 54 H336 M194 128 H336 M194 128 L272 202 H336" />
				<path d="M326 44 L336 54 L326 64 M326 118 L336 128 L326 138 M326 192 L336 202 L326 212" />
				<circle cx="194" cy="128" r="5" fill="currentColor" />
			</g>
			<text x="24" y="112" class="flow-input">These&lt;A, B&gt;</text>
			<text x="352" y="60" class="flow-label">First(A)</text>
			<text x="456" y="60" class="flow-value">· value</text>
			<text x="352" y="134" class="flow-label">Both(A, B)</text>
			<text x="476" y="134" class="flow-value">· + warn</text>
			<text x="352" y="208" class="flow-label">Second(B)</text>
			<text x="468" y="208" class="flow-value">· warn</text>
		`,
	},
	"guides/pair": {
		plate: "#e6dec8",
		title: "Independent mapping and merge on Pair",
		desc:
			"Pair holds two values: mapFirst updates the first position, mapSecond updates the second, and merge joins them.",
		caption: "Pair · Transform positions independently, then merge",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M24 128 H132 M132 128 L178 68 H392 L438 128 H496 M132 128 L178 188 H392 L438 128" />
				<path d="M486 118 L496 128 L486 138" />
				<rect x="206" y="44" width="156" height="48" class="flow-node" />
				<rect x="206" y="164" width="156" height="48" class="flow-node" />
				<circle cx="132" cy="128" r="5" fill="currentColor" />
				<circle cx="438" cy="128" r="5" fill="currentColor" />
			</g>
			<text x="24" y="112" class="flow-value">[k, v]</text>
			<text x="284" y="68" text-anchor="middle" dominant-baseline="central" class="flow-value">mapFirst</text>
			<text x="284" y="188" text-anchor="middle" dominant-baseline="central" class="flow-value">mapSecond</text>
			<text x="510" y="134" class="flow-value">merge</text>
		`,
	},
	"guides/machine": {
		plate: "#d9ccf3",
		title: "Explicit transitions in Machine",
		desc:
			"An actor transitions between explicit states on named events, triggering exit and entry effects only when changing state.",
		caption: "Machine · Explicit states and typed transitions",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M180 106 H414 M402 95 L414 106 L402 117" />
				<path d="M418 156 Q300 232 182 156 M190 172 L182 156 L199 160" />
				<circle cx="128" cy="116" r="52" class="flow-node" />
				<circle cx="470" cy="116" r="52" class="flow-node" />
			</g>
			<text x="128" y="116" text-anchor="middle" dominant-baseline="central" class="flow-label">idle</text>
			<text x="470" y="116" text-anchor="middle" dominant-baseline="central" class="flow-label">active</text>
			<text x="298" y="88" text-anchor="middle" class="flow-value">start(payload)</text>
			<text x="298" y="218" text-anchor="middle" class="flow-value">reset</text>
		`,
	},
	"guides/state": {
		plate: "#d9ccf3",
		title: "Threading updated state through State",
		desc: "Each step reads the current state and passes the next immutable state plus an intermediate value forward.",
		caption: "State · Thread updated counters without mutation",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M24 84 H544 M534 74 L544 84 L534 94" />
				<path d="M182 84 V174 H296 M362 84 V174 H480" />
				<rect x="124" y="54" width="116" height="60" class="flow-node" />
				<rect x="304" y="54" width="116" height="60" class="flow-node" />
			</g>
			<text x="24" y="66" class="flow-value">s0</text>
			<text x="182" y="84" text-anchor="middle" dominant-baseline="central" class="flow-value">step 1</text>
			<text x="270" y="66" class="flow-value">s1</text>
			<text x="362" y="84" text-anchor="middle" dominant-baseline="central" class="flow-value">step 2</text>
			<text x="524" y="66" class="flow-value">s2</text>
			<text x="218" y="196" class="flow-value">id 1</text>
			<text x="398" y="196" class="flow-value">id 2</text>
		`,
	},
	"guides/reader": {
		plate: "#b8e6d8",
		title: "Shared environment distribution in Reader",
		desc: "A shared configuration object supplied once at run feeds every Reader step without explicit argument passing.",
		caption: "Reader · Supply environment once at the outer edge",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M40 58 H490" />
				<path d="M150 58 V126 M300 58 V126 M450 58 V126" />
				<path d="M142 116 L150 126 L158 116 M292 116 L300 126 L308 116 M442 116 L450 126 L458 116" />
				<path d="M210 166 H240 M360 166 H390" />
				<rect x="90" y="128" width="120" height="76" class="flow-node" />
				<rect x="240" y="128" width="120" height="76" class="flow-node" />
				<rect x="390" y="128" width="120" height="76" class="flow-node" />
			</g>
			<text x="40" y="42" class="flow-value">Reader.run(env)</text>
			<text x="150" y="166" text-anchor="middle" dominant-baseline="central" class="flow-value">step A</text>
			<text x="300" y="166" text-anchor="middle" dominant-baseline="central" class="flow-value">step B</text>
			<text x="450" y="166" text-anchor="middle" dominant-baseline="central" class="flow-value">step C</text>
		`,
	},
	"guides/logged": {
		plate: "#c7e3b5",
		title: "Accumulating trace entries in Logged",
		desc:
			"Chained steps transform the value on the top track while appending structured log entries along the bottom rail.",
		caption: "Logged · Transform values while appending trace entries",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M24 82 H554 M544 72 L554 82 L544 92" />
				<path d="M24 176 H554 M544 166 L554 176 L544 186" />
				<circle cx="196" cy="82" r="28" class="flow-node" />
				<circle cx="384" cy="82" r="28" class="flow-node" />
				<path d="M196 110 V176 M384 110 V176" class="flow-dash" />
			</g>
			<text x="24" y="64" class="flow-value">value</text>
			<text x="196" y="82" text-anchor="middle" dominant-baseline="central" class="flow-tag">fn 1</text>
			<text x="384" y="82" text-anchor="middle" dominant-baseline="central" class="flow-tag">fn 2</text>
			<text x="24" y="210" class="flow-value">entries: []</text>
			<text x="196" y="210" text-anchor="middle" class="flow-value">[e1]</text>
			<text x="384" y="210" text-anchor="middle" class="flow-value">[e1, e2]</text>
		`,
	},
};
