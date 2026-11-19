import type { HeroFigureSpec } from "./types";

export const DATA_AND_TYPE_FIGURES: Record<string, HeroFigureSpec> = {
	"guides/equality": {
		plate: "#b4dce2",
		title: "Structural equality comparison in Equality",
		desc: "Two readings compare field by field in order and resolve to true or false on the first mismatch.",
		caption: "Equality · Composable field-by-field structural equality",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M170 72 H242 L310 128 M170 184 H242 L310 128" />
				<path d="M310 128 L382 72 H454 M310 128 L382 184 H454" />
				<path d="M444 62 L454 72 L444 82 M444 174 L454 184 L444 194" />
				<circle cx="310" cy="128" r="6" fill="currentColor" />
			</g>
			<text x="156" y="72" text-anchor="end" dominant-baseline="central" class="flow-value">{ id, ts }</text>
			<text x="156" y="184" text-anchor="end" dominant-baseline="central" class="flow-value">{ id, ts }</text>
			<text x="468" y="72" dominant-baseline="central" class="flow-label">true</text>
			<text x="468" y="184" dominant-baseline="central" class="flow-label">false</text>
		`,
	},
	"guides/ordering": {
		plate: "#f7d4bc",
		title: "Composable sorting with Ordering",
		desc:
			"Three unordered scores (9, 2, 5) weave smoothly through a multi-key comparator into ascending order (2, 5, 9).",
		caption: "Ordering · Chainable primary and tie-breaker comparators",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M92 60 H148 C248 60 338 196 436 196 H502" />
				<path d="M92 128 H148 C248 128 338 60 436 60 H502" />
				<path d="M92 196 H148 C248 196 338 128 436 128 H502" />
			</g>
			<text x="74" y="60" text-anchor="end" dominant-baseline="central" class="flow-input">9</text>
			<text x="74" y="128" text-anchor="end" dominant-baseline="central" class="flow-input">2</text>
			<text x="74" y="196" text-anchor="end" dominant-baseline="central" class="flow-input">5</text>
			<text x="520" y="60" dominant-baseline="central" class="flow-input">2</text>
			<text x="520" y="128" dominant-baseline="central" class="flow-input">5</text>
			<text x="520" y="196" dominant-baseline="central" class="flow-input">9</text>
		`,
	},
	"guides/predicate": {
		plate: "#dcefb8",
		title: "Short-circuit boolean combinators in Predicate",
		desc: "Predicate.and runs the second check only when the first returns true, skipping redundant work on false.",
		caption: "Predicate · Combine reusable boolean checks with short-circuiting",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M-8 128 H126" />
				<path d="M276 128 H344 M276 128 L338 196 H490" />
				<path d="M494 128 H544 M334 118 L344 128 L334 138 M534 118 L544 128 L534 138" />
				<rect x="126" y="96" width="150" height="64" class="flow-node" />
				<rect x="344" y="96" width="150" height="64" class="flow-node" />
			</g>
			<text x="201" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">isPending</text>
			<text x="419" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">hasReport</text>
			<text x="556" y="134" class="flow-tag">ok</text>
			<text x="356" y="220" class="flow-value">false · skip second check</text>
		`,
	},
	"guides/refinement": {
		plate: "#c5daf6",
		title: "Sequential type-guard narrowing in Refinement",
		desc:
			"Refinement.compose runs an object shape check first and only enters the field guard after TypeScript narrows the input.",
		caption: "Refinement · Narrow unknown data step by step without casts",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M118 128 H164 M296 128 H342 M474 128 H520" />
				<path d="M154 118 L164 128 L154 138 M332 118 L342 128 L332 138 M510 118 L520 128 L510 138" />
				<rect x="164" y="88" width="132" height="80" class="flow-node" />
				<rect x="342" y="88" width="132" height="80" class="flow-node" />
			</g>
			<text x="104" y="128" text-anchor="end" dominant-baseline="central" class="flow-value">unknown</text>
			<text x="230" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">isRecord</text>
			<text x="408" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">hasKind</text>
			<text x="534" y="128" dominant-baseline="central" class="flow-value">Event</text>
		`,
	},
	"guides/combinable": {
		plate: "#c7e3b5",
		title: "Associative reduction with Combinable",
		desc:
			"combineAll folds an array of metric summaries left-to-right starting from empty using the rule's combine operation.",
		caption: "Combinable · Reduce sequences cleanly from an empty identity",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M148 56 H228 L314 128 M148 128 H314 M148 200 H228 L314 128" />
				<path d="M314 128 H446 M436 118 L446 128 L436 138" />
				<circle cx="314" cy="128" r="28" class="flow-node" />
			</g>
			<text x="134" y="56" text-anchor="end" dominant-baseline="central" class="flow-value">window A</text>
			<text x="134" y="128" text-anchor="end" dominant-baseline="central" class="flow-value">window B</text>
			<text x="134" y="200" text-anchor="end" dominant-baseline="central" class="flow-value">window C</text>
			<text x="314" y="128" text-anchor="middle" dominant-baseline="central" class="flow-label">+</text>
			<text x="462" y="128" dominant-baseline="central" class="flow-label">merged</text>
		`,
	},
	"guides/brand": {
		plate: "#d9ccf3",
		title: "Zero-cost nominal types with Brand",
		desc:
			"At compile time Brand separates UserId from AccountId strings while keeping the underlying runtime value identical.",
		caption: "Brand · Distinct compile-time types with zero runtime wrapper",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M150 128 H224 M376 128 H450" />
				<path d="M214 118 L224 128 L214 138 M440 118 L450 128 L440 138" />
				<rect x="224" y="76" width="152" height="104" class="flow-node flow-dash" />
			</g>
			<text x="136" y="128" text-anchor="end" dominant-baseline="central" class="flow-value">"usr_12"</text>
			<text x="300" y="128" text-anchor="middle" dominant-baseline="central" class="flow-tag">type seal</text>
			<text x="464" y="128" dominant-baseline="central" class="flow-value">UserId</text>
			<text x="300" y="208" text-anchor="middle" class="flow-tag">runtime value unchanged</text>
		`,
	},
	"guides/duration": {
		plate: "#e6dec8",
		title: "Unit-safe millisecond arithmetic in Duration",
		desc: "Duration.minutes and Duration.seconds normalize distinct units into a single Duration value in milliseconds.",
		caption: "Duration · Express time units explicitly, compute safely in ms",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M190 78 H272 L340 128 M190 178 H272 L340 128" />
				<path d="M364 128 H424 M414 118 L424 128 L414 138" />
				<circle cx="340" cy="128" r="24" class="flow-node" />
			</g>
			<text x="176" y="78" text-anchor="end" dominant-baseline="central" class="flow-value">minutes(5)</text>
			<text x="176" y="178" text-anchor="end" dominant-baseline="central" class="flow-value">seconds(30)</text>
			<text x="340" y="128" text-anchor="middle" dominant-baseline="central" class="flow-label">+</text>
			<text x="438" y="128" dominant-baseline="central" class="flow-value">330_000 ms</text>
		`,
	},
	"guides/policies": {
		plate: "#f7dfa8",
		title: "Composable timeout and exponential retry schedules",
		desc:
			"Successive retry attempts run under per-attempt timeouts spaced by growing backoff delays until settled or exhausted.",
		caption: "Policies · Timeout, exponential retry, and repeat intervals",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M24 148 H560 M550 138 L560 148 L550 158" />
				<rect x="52" y="114" width="60" height="68" class="flow-node" />
				<rect x="172" y="114" width="60" height="68" class="flow-node" />
				<rect x="332" y="114" width="60" height="68" class="flow-node" />
			</g>
			<text x="82" y="148" text-anchor="middle" dominant-baseline="central" class="flow-tag">try 1</text>
			<text x="142" y="96" text-anchor="middle" class="flow-tag">100ms</text>
			<text x="202" y="148" text-anchor="middle" dominant-baseline="central" class="flow-tag">try 2</text>
			<text x="282" y="96" text-anchor="middle" class="flow-tag">200ms</text>
			<text x="362" y="148" text-anchor="middle" dominant-baseline="central" class="flow-tag">try 3</text>
			<text x="476" y="126" text-anchor="middle" class="flow-value">settled</text>
		`,
	},
	"guides/nonempty": {
		plate: "#b4dce2",
		title: "Boundary non-emptiness guard in NonEmpty",
		desc: "A runtime check rejects empty collections to None and promotes populated inputs to NonEmpty types safely.",
		caption: "NonEmpty · Enforce non-empty arrays, strings, sets, and records",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M-8 128 H212 L288 68 H366 M212 128 L288 188 H366" />
				<path d="M356 58 L366 68 L356 78 M356 178 L366 188 L356 198" />
				<circle cx="212" cy="128" r="5" fill="currentColor" />
			</g>
			<text x="24" y="112" class="flow-value">size &gt; 0 ?</text>
			<text x="382" y="74" class="flow-label">Some(NonEmpty)</text>
			<text x="382" y="194" class="flow-label">None</text>
		`,
	},
	"guides/lens": {
		plate: "#b4dce2",
		title: "Focusing a nested field with Lens",
		desc:
			"A Lens zooms into a nested field (such as audio.volume) to read or copy-on-write update without mutating outer objects.",
		caption: "Lens · Immutable read and structural update on nested fields",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<rect x="46" y="42" width="320" height="172" class="flow-node" />
				<rect x="102" y="82" width="208" height="92" class="flow-node" />
				<path d="M310 128 H540 M530 118 L540 128 L530 138" />
			</g>
			<text x="206" y="128" text-anchor="middle" dominant-baseline="central" class="flow-input">city</text>
			<text x="388" y="108" class="flow-value">get / modify</text>
		`,
	},
	"guides/optional": {
		plate: "#b4dce2",
		title: "Optional nested field access and update",
		desc:
			"Optional reads or updates a path that may be absent, returning Some(value) on hit or leaving missing structures untouched.",
		caption: "Optional · Modify nested fields only when present",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<rect x="46" y="42" width="248" height="172" class="flow-node" />
				<rect x="86" y="82" width="168" height="92" class="flow-node flow-dash" />
				<path d="M254 128 L324 68 H392 M254 128 L324 188 H392" />
				<path d="M382 58 L392 68 L382 78 M382 178 L392 188 L382 198" />
				<circle cx="254" cy="128" r="5" fill="currentColor" />
			</g>
			<text x="170" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">profile?</text>
			<text x="408" y="68" dominant-baseline="central" class="flow-label">Some -> update</text>
			<text x="408" y="188" dominant-baseline="central" class="flow-label">None -> keep</text>
		`,
	},
	"guides/arr": {
		plate: "#e6dec8",
		title: "Dense partitioning of arrays in Arr",
		desc: "Arr.partition separates mixed items into matched and unmatched readonly arrays in a single pass.",
		caption: "Arr · Single-pass immutable filtering and partitioning",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="46" cy="128" r="14" class="flow-node" />
				<rect x="82" y="114" width="28" height="28" class="flow-node" />
				<circle cx="146" cy="128" r="14" class="flow-node" />
				<rect x="182" y="114" width="28" height="28" class="flow-node" />
				<path d="M236 128 H282 L348 68 H402 M282 128 L348 188 H402" />
				<circle cx="438" cy="68" r="14" class="flow-node" />
				<circle cx="490" cy="68" r="14" class="flow-node" />
				<rect x="424" y="174" width="28" height="28" class="flow-node" />
				<rect x="476" y="174" width="28" height="28" class="flow-node" />
			</g>
		`,
	},
	"guides/rec": {
		plate: "#bce5f5",
		title: "Own-key record merge and transformation in Rec",
		desc: "Rec.merge overlays defaults with overrides in own-key enumeration order without mutating either object.",
		caption: "Rec · Immutable own-property transforms and merges",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<rect x="34" y="48" width="174" height="68" class="flow-node" />
				<rect x="34" y="140" width="174" height="68" class="flow-node" />
				<path d="M208 82 H284 L350 128 H392 M208 174 H284 L350 128" />
				<path d="M382 118 L392 128 L382 138" />
				<rect x="400" y="54" width="166" height="148" class="flow-node" />
			</g>
			<text x="121" y="82" text-anchor="middle" dominant-baseline="central" class="flow-value">defaults</text>
			<text x="121" y="174" text-anchor="middle" dominant-baseline="central" class="flow-value">overrides</text>
			<text x="483" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">{ merged }</text>
		`,
	},
	"guides/dict": {
		plate: "#b8e6d8",
		title: "Single-lookup upsert on Map in Dict",
		desc: "Dict.upsert checks key existence once and hands Some(prev) or None to the updater to produce a new Map.",
		caption: "Dict · Typed Map operations without prototype-key hazards",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M-8 128 H194 L276 68 H350 M194 128 L276 188 H350" />
				<path d="M340 58 L350 68 L340 78 M340 178 L350 188 L340 198" />
				<circle cx="194" cy="128" r="5" fill="currentColor" />
			</g>
			<text x="24" y="112" class="flow-value">upsert(k)</text>
			<text x="366" y="74" class="flow-label">Some(prev)</text>
			<text x="366" y="194" class="flow-label">None -> init</text>
		`,
	},
	"guides/uniq": {
		plate: "#dcefb8",
		title: "Set difference filtering in Uniq",
		desc: "Uniq.difference subtracts disabled entries from requested items while returning a clean immutable Set.",
		caption: "Uniq · Set algebra with zero-dependency runtime fallbacks",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="216" cy="128" r="78" class="flow-node" />
				<circle cx="332" cy="128" r="78" class="flow-dash" />
				<path d="M428 128 H536 M526 118 L536 128 L526 138" />
			</g>
			<text x="176" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">want</text>
			<text x="368" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">deny</text>
			<text x="482" y="106" text-anchor="middle" class="flow-tag">difference</text>
		`,
	},
	"guides/str": {
		plate: "#e6dec8",
		title: "Curried line splitting and blank filtering in Str",
		desc: "Str.lines breaks raw text into lines, drops blank rows with is.blank, and extracts normalized tokens.",
		caption: "Str · Unicode-safe string helpers built for pipe",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M118 128 H158 M266 128 H306 M428 128 H472" />
				<path d="M148 118 L158 128 L148 138 M296 118 L306 128 L296 138 M462 118 L472 128 L462 138" />
				<rect x="158" y="88" width="108" height="80" class="flow-node" />
				<rect x="306" y="88" width="122" height="80" class="flow-node" />
			</g>
			<text x="104" y="128" text-anchor="end" dominant-baseline="central" class="flow-value">"a\\n\\nb"</text>
			<text x="212" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">lines</text>
			<text x="367" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">!is.blank</text>
			<text x="484" y="128" dominant-baseline="central" class="flow-value">["a", "b"]</text>
		`,
	},
	"guides/num": {
		plate: "#c5daf6",
		title: "Safe numeric division in Num",
		desc: "Num.divide checks for a zero divisor before computing, returning None instead of Infinity or NaN.",
		caption: "Num · Finite numeric parsing, clamping, and safe division",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M-8 128 H200 L284 68 H366 M200 128 L284 188 H366" />
				<path d="M356 58 L366 68 L356 78 M356 178 L366 188 L356 198" />
				<circle cx="200" cy="128" r="5" fill="currentColor" />
			</g>
			<text x="24" y="112" class="flow-value">divisor === 0?</text>
			<text x="382" y="76" class="flow-case">Some</text>
			<text x="382" y="102" class="flow-value">finite quotient</text>
			<text x="382" y="198" class="flow-case">None</text>
			<text x="382" y="224" class="flow-value">no Infinity/NaN</text>
		`,
	},
	"guides/bignum": {
		plate: "#f2c6d8",
		title: "Safe arbitrary-precision parsing in BigNum",
		desc: "BigNum.from.string guards malformed integer strings and BigNum.divide rejects zero divisors via Maybe.",
		caption: "BigNum · Exact bigint parsing and safe division without throws",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M-8 128 H206 L284 68 H366 M206 128 L284 188 H366" />
				<path d="M356 58 L366 68 L356 78 M356 178 L366 188 L356 198" />
				<circle cx="206" cy="128" r="5" fill="currentColor" />
			</g>
			<text x="24" y="112" class="flow-value">"1099511627776"</text>
			<text x="382" y="76" class="flow-case">Some</text>
			<text x="382" y="102" class="flow-value">bigint value</text>
			<text x="382" y="198" class="flow-case">None</text>
			<text x="382" y="224" class="flow-value">bad syntax / /0</text>
		`,
	},
	"guides/bool": {
		plate: "#c7e3b5",
		title: "Lazy short-circuit evaluation in Bool",
		desc: "Bool.andLazy evaluates its thunk only when the flag is true, skipping downstream work otherwise.",
		caption: "Bool · Lazy boolean logic and strict string parsing",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M-8 128 H194 L276 68 H350 M194 128 L276 188 H350" />
				<path d="M340 58 L350 68 L340 78 M340 178 L350 188 L340 198" />
				<circle cx="194" cy="128" r="5" fill="currentColor" />
			</g>
			<text x="24" y="112" class="flow-value">andLazy(flag)</text>
			<text x="366" y="74" class="flow-label">true -> eval thunk</text>
			<text x="366" y="194" class="flow-label">false -> skip</text>
		`,
	},
	"guides/json": {
		plate: "#c5daf6",
		title: "Exception-free parsing in Json",
		desc:
			"Json.parse turns malformed JSON or stringify cycles into a typed Result error instead of an uncaught exception.",
		caption: "Json · Typed Result boundaries around JSON.parse and stringify",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M-8 128 H196 L278 68 H350 M196 128 L278 188 H350" />
				<path d="M340 58 L350 68 L340 78 M340 178 L350 188 L340 198" />
				<circle cx="196" cy="128" r="5" fill="currentColor" />
			</g>
			<text x="24" y="112" class="flow-input">Json.parse</text>
			<text x="368" y="76" class="flow-case">Ok</text>
			<text x="368" y="102" class="flow-value">Json.Value</text>
			<text x="368" y="198" class="flow-case">Err</text>
			<text x="368" y="224" class="flow-value">JsonParseError</text>
		`,
	},
};
