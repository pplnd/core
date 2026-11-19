import type { HeroFigureSpec } from "./types";

export const REACT_AND_RECIPE_FIGURES: Record<string, HeroFigureSpec> = {
	"guides/react-bindings": {
		plate: "#bce5f5",
		title: "Pure core engine feeding React render bindings",
		desc:
			"Business logic stays outside React in @pplnd/core while @pplnd/react hooks project snapshots and clean up on unmount.",
		caption: "@pplnd/react · Ownership stays in core, hooks bind to components",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<rect x="34" y="56" width="210" height="144" class="flow-node" />
				<path d="M244 102 H354 M344 92 L354 102 L344 112" />
				<path d="M354 154 H244 M254 144 L244 154 L254 164" />
				<rect x="356" y="56" width="210" height="144" class="flow-node" />
			</g>
			<text x="139" y="116" text-anchor="middle" class="flow-value">@pplnd/core</text>
			<text x="139" y="148" text-anchor="middle" class="flow-tag">state &amp; engines</text>
			<text x="461" y="116" text-anchor="middle" class="flow-value">@pplnd/react</text>
			<text x="461" y="148" text-anchor="middle" class="flow-tag">snapshots &amp; unmount</text>
			<text x="300" y="88" text-anchor="middle" class="flow-tag">state</text>
			<text x="300" y="182" text-anchor="middle" class="flow-tag">abort</text>
		`,
	},
	"guides/use-load": {
		plate: "#c5daf6",
		title: "Dependency-keyed RemoteData loading in useLoad",
		desc:
			"Changing dependencies aborts the previous signal, switches immediately to Loading, and settles into Success or Failure.",
		caption: "useLoad · Cancel stale fetches when React dependencies change",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M124 68 H236 M250 58 L270 78 M250 78 L270 58 M260 88 V142" />
				<path d="M260 152 H316 M306 142 L316 152 L306 162" />
				<rect x="316" y="122" width="104" height="60" class="flow-node" />
				<path d="M420 152 L456 112 H486 M420 152 L456 192 H486" />
				<path d="M476 102 L486 112 L476 122 M476 182 L486 192 L476 202" />
				<circle cx="124" cy="68" r="5" fill="currentColor" />
				<circle cx="260" cy="152" r="5" fill="currentColor" />
			</g>
			<text x="108" y="68" text-anchor="end" dominant-baseline="central" class="flow-value">id: 1</text>
			<text x="288" y="68" dominant-baseline="central" class="flow-value">aborted stale fetch</text>
			<text x="244" y="152" text-anchor="end" dominant-baseline="central" class="flow-value">id: 2</text>
			<text x="368" y="152" text-anchor="middle" dominant-baseline="central" class="flow-value">Loading</text>
			<text x="498" y="112" dominant-baseline="central" class="flow-value">Success</text>
			<text x="498" y="192" dominant-baseline="central" class="flow-value">Failure</text>
		`,
	},
	"guides/use-op": {
		plate: "#f6cbb7",
		title: "Imperative Op binding in useOp",
		desc:
			"useOp binds a component to a managed Op instance, surfacing [state, run, abort] without recreating overlap rules.",
		caption: "useOp · Subscribe to Op state, trigger runs, abort on unmount",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<rect x="44" y="76" width="160" height="104" class="flow-node" />
				<path d="M204 100 H348 M338 90 L348 100 L338 110" />
				<path d="M348 156 H204 M214 146 L204 156 L214 166" />
				<rect x="350" y="76" width="206" height="104" class="flow-node" />
			</g>
			<text x="124" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">Op Manager</text>
			<text x="276" y="86" text-anchor="middle" class="flow-tag">state</text>
			<text x="276" y="182" text-anchor="middle" class="flow-tag">run / abort</text>
			<text x="453" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">Component</text>
		`,
	},
	"guides/use-op-poll": {
		plate: "#dcefb8",
		title: "Interval polling lifecycle in useOpPoll",
		desc: "useOpPoll schedules interval runs through an Op manager, pausing cleanly when hidden or inactive.",
		caption: "useOpPoll · Cadenced Op polling bound to visibility and mount",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M30 132 H554 M544 122 L554 132 L544 142" />
				<circle cx="110" cy="132" r="28" class="flow-node" />
				<circle cx="266" cy="132" r="28" class="flow-node" />
				<circle cx="422" cy="132" r="28" class="flow-node" />
			</g>
			<text x="110" y="132" text-anchor="middle" dominant-baseline="central" class="flow-tag">tick</text>
			<text x="266" y="132" text-anchor="middle" dominant-baseline="central" class="flow-tag">tick</text>
			<text x="422" y="132" text-anchor="middle" dominant-baseline="central" class="flow-tag">tick</text>
			<text x="188" y="84" text-anchor="middle" class="flow-value">interval</text>
			<text x="516" y="110" text-anchor="middle" class="flow-tag">stop</text>
		`,
	},
	"guides/use-machine": {
		plate: "#d9ccf3",
		title: "Component-scoped Machine hook in useMachine",
		desc:
			"useMachine creates a Machine actor for the component lifetime, returns [state, send], and stops the actor on unmount.",
		caption: "useMachine · Component-owned actor with cleanup on unmount",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M182 102 H414 M402 91 L414 102 L402 113" />
				<path d="M416 154 H184 M196 143 L184 154 L196 165" />
				<circle cx="126" cy="128" r="56" class="flow-node" />
				<rect x="416" y="76" width="144" height="104" class="flow-node" />
			</g>
			<text x="126" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">Machine</text>
			<text x="488" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">React UI</text>
			<text x="298" y="84" text-anchor="middle" class="flow-value">[state]</text>
			<text x="298" y="182" text-anchor="middle" class="flow-value">send(ev)</text>
		`,
	},
	"guides/use-actor": {
		plate: "#d9ccf3",
		title: "Selector projections over shared Machine.Actor in useActor",
		desc:
			"Multiple components subscribe with narrow selectors to one shared Machine.Actor, re-rendering only when their slice changes.",
		caption: "useActor · Bind shared actors cleanly with selector slices",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M180 128 H258 L328 72 H380 M258 128 L328 184 H380" />
				<circle cx="116" cy="128" r="64" class="flow-node" />
				<rect x="380" y="42" width="186" height="60" class="flow-node" />
				<rect x="380" y="154" width="186" height="60" class="flow-node" />
			</g>
			<text x="116" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">Cart Actor</text>
			<text x="473" y="72" text-anchor="middle" dominant-baseline="central" class="flow-value">badge(count)</text>
			<text x="473" y="184" text-anchor="middle" dominant-baseline="central" class="flow-value">list(items)</text>
		`,
	},
	"guides/use-event-bus": {
		plate: "#b8e6d8",
		title: "Automatic subscription cleanup in useEventBus",
		desc: "useEventBus wires a sibling listener to a shared EventBus channel and unsubscribes automatically on unmount.",
		caption: "useEventBus · Mount-scoped subscription with zero leaks",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M174 128 H292 M292 68 V188 M292 68 H392 M292 188 H392" />
				<path d="M382 58 L392 68 L382 78 M382 178 L392 188 L382 198" />
				<rect x="24" y="92" width="150" height="72" class="flow-node" />
				<rect x="394" y="38" width="172" height="60" class="flow-node" />
				<rect x="394" y="158" width="172" height="60" class="flow-node" />
			</g>
			<text x="99" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">emit(ev)</text>
			<text x="480" y="68" text-anchor="middle" dominant-baseline="central" class="flow-value">Sidebar UI</text>
			<text x="480" y="188" text-anchor="middle" dominant-baseline="central" class="flow-value">Badge UI</text>
		`,
	},
	"guides/use-resource": {
		plate: "#f2c6d8",
		title: "Mount-to-unmount resource scoping in useResource",
		desc:
			"useResource opens an async resource on mount, tracks acquiring/ready/failed state, and guarantees release on unmount.",
		caption: "useResource · Pair component mount and unmount with Resource",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M72 56 V196 H528 V56" />
				<path d="M518 68 L528 56 L538 68" />
				<circle cx="72" cy="56" r="5" fill="currentColor" />
				<circle cx="298" cy="196" r="6" fill="currentColor" />
			</g>
			<text x="90" y="56" dominant-baseline="central" class="flow-label">mount -> acquire</text>
			<text x="298" y="172" text-anchor="middle" class="flow-value">ready in render</text>
			<text x="502" y="56" text-anchor="end" dominant-baseline="central" class="flow-label">unmount -> release</text>
		`,
	},
	"recipes/request-lifecycle": {
		plate: "#c5daf6",
		title: "End-to-end HTTP form request pipeline",
		desc: "Form data flows from Validation into an Op managed under RetryPolicy and surfaces in RemoteData.",
		caption: "Recipe · Validation -> Op -> RetryPolicy -> RemoteData",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M98 172 V212 H502 V172" class="flow-dash" />
				<path d="M492 182 L502 172 L512 182" />
				<path d="M168 128 H206 M346 128 H384" />
				<path d="M196 118 L206 128 L196 138 M374 118 L384 128 L374 138" />
				<rect x="28" y="84" width="140" height="88" class="flow-node" />
				<rect x="206" y="84" width="140" height="88" class="flow-node" />
				<rect x="384" y="84" width="188" height="88" class="flow-node" />
			</g>
			<text x="98" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">Validation</text>
			<text x="276" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">Op + Policy</text>
			<text x="478" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">RemoteData</text>
			<text x="300" y="232" text-anchor="middle" class="flow-tag">errors flow straight into Failure without throw</text>
		`,
	},
	"recipes/field-validation": {
		plate: "#f7d4bc",
		title: "Pure validation separated from UI error visibility",
		desc:
			"Pure Validation.keyed evaluates all fields unconditionally while a visibility trigger decides when errors show.",
		caption: "Recipe · Separate pure field checks from blur/submit visibility",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M168 78 H274 L344 128 M168 178 H274 L344 128 M344 128 H406" />
				<path d="M396 118 L406 128 L396 138" />
				<rect x="28" y="48" width="140" height="60" class="flow-node" />
				<rect x="28" y="148" width="140" height="60" class="flow-node" />
			</g>
			<text x="98" y="78" text-anchor="middle" dominant-baseline="central" class="flow-value">Validation</text>
			<text x="98" y="178" text-anchor="middle" dominant-baseline="central" class="flow-value">Visibility</text>
			<text x="422" y="134" class="flow-label">form errors</text>
		`,
	},
	"recipes/dependency-graph": {
		plate: "#bce5f5",
		title: "Graph reads feeding Transaction writes inside Resource cleanup",
		desc: "Resource holds DB locks around a concurrent Graph read phase and a compensating Transaction write phase.",
		caption: "Recipe · Resource bracket -> Graph reads -> Transaction writes",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<rect x="28" y="34" width="544" height="188" class="flow-node" />
				<path d="M188 128 H272 M384 128 H442" />
				<path d="M262 118 L272 128 L262 138 M432 118 L442 128 L432 138" />
				<rect x="76" y="76" width="112" height="104" class="flow-node" />
				<rect x="272" y="76" width="112" height="104" class="flow-node" />
				<rect x="442" y="76" width="96" height="104" class="flow-node" />
			</g>
			<text x="300" y="58" text-anchor="middle" class="flow-tag">Resource scope (LIFO release)</text>
			<text x="132" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">Graph</text>
			<text x="328" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">Commit</text>
			<text x="490" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">Undo ×</text>
		`,
	},
	"recipes/events-and-state": {
		plate: "#b8e6d8",
		title: "EventBus routing upload events into Machine and Op",
		desc:
			"EventBus delivers uploadFinished to a Machine actor, which transitions state and dispatches the validation Op.",
		caption: "Recipe · EventBus -> Machine transitions -> managed Op",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M168 128 H212 M352 128 H396 M202 118 L212 128 L202 138 M386 118 L396 128 L386 138" />
				<rect x="28" y="84" width="140" height="88" class="flow-node" />
				<rect x="212" y="84" width="140" height="88" class="flow-node" />
				<rect x="396" y="84" width="176" height="88" class="flow-node" />
			</g>
			<text x="98" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">EventBus</text>
			<text x="282" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">Machine</text>
			<text x="484" y="128" text-anchor="middle" dominant-baseline="central" class="flow-value">validate Op</text>
		`,
	},
};
