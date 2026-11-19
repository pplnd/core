export interface NavItem {
	readonly label: string;
	readonly slug: string;
	readonly href: string;
	readonly desc?: string;
}

export interface NavGroup {
	readonly id: string;
	readonly kind: "group";
	readonly label: string;
	readonly items: readonly NavItem[];
}

export interface NavLink {
	readonly id: string;
	readonly kind: "link";
	readonly label: string;
	readonly slug: string;
	readonly href: string;
	readonly desc?: string;
}

export type NavEntry = NavGroup | NavLink;

export interface SearchEntry {
	readonly label: string;
	readonly href: string;
	readonly section: string;
	readonly meta?: string;
	readonly desc: string;
}

export interface HomeCard {
	readonly meta: string;
	readonly title: string;
	readonly href: string;
	readonly variant: string;
	readonly svgBody: string;
	readonly svgRole?: "img";
	readonly svgLabel?: string;
}

export const NAV_ENTRIES: readonly NavEntry[] = [{
	id: "p-basics",
	kind: "group",
	label: "The basics",
	items: [{
		label: "Overview",
		slug: "basics/overview",
		href: "/basics/overview/",
		desc: "Model runtime states explicitly",
	}, {
		label: "Quickstart",
		slug: "basics/quickstart",
		href: "/basics/quickstart/",
		desc: "Handle one fallible function with Result",
	}, {
		label: "Installation",
		slug: "basics/installation",
		href: "/basics/installation/",
		desc: "Add @pplnd/core and check bundle sizes",
	}, {
		label: "Thinking in pipelines",
		slug: "basics/pipelines",
		href: "/basics/pipelines/",
		desc: "Sequence transformations top-to-bottom with pipe and flow",
	}, {
		label: "Reading the types",
		slug: "basics/types",
		href: "/basics/types/",
		desc: "Type parameters, channels, and execution shapes",
	}, {
		label: "Choosing a container",
		slug: "basics/choosing",
		href: "/basics/choosing/",
		desc: "Pick the type that matches the shape of the problem",
	}, {
		label: "Plain TypeScript",
		slug: "basics/plain-ts",
		href: "/basics/plain-ts/",
		desc: "Map familiar JS/TS idioms onto pipelined",
	}, {
		label: "Composition",
		slug: "basics/composition",
		href: "/basics/composition/",
		desc: "Currying, branching, structs, and async pipelines",
	}],
}, {
	id: "p-recipes",
	kind: "group",
	label: "Recipes",
	items: [{
		label: "Request lifecycle",
		slug: "recipes/request-lifecycle",
		href: "/recipes/request-lifecycle/",
		desc: "Validate input, run under policy, and render RemoteData",
	}, {
		label: "Field validation",
		slug: "recipes/field-validation",
		href: "/recipes/field-validation/",
		desc: "Accumulate field errors and control visibility separately",
	}, {
		label: "Dependency graph",
		slug: "recipes/dependency-graph",
		href: "/recipes/dependency-graph/",
		desc: "Combine Graph, Transaction, and Resource cleanup",
	}, {
		label: "Events & state",
		slug: "recipes/events-and-state",
		href: "/recipes/events-and-state/",
		desc: "Connect EventBus messages to a state Machine",
	}],
}, {
	id: "p-errors",
	kind: "group",
	label: "Errors & absence",
	items: [
		{ label: "Maybe", slug: "guides/maybe", href: "/guides/maybe/", desc: "Explicit presence or absence without null" },
		{
			label: "Result",
			slug: "guides/result",
			href: "/guides/result/",
			desc: "Branch on synchronous success or typed failure",
		},
		{
			label: "Validation",
			slug: "guides/validation",
			href: "/guides/validation/",
			desc: "Accumulate every independent validation error",
		},
		{
			label: "RemoteData",
			slug: "guides/remote-data",
			href: "/guides/remote-data/",
			desc: "Four-state async lifecycle: unasked, loading, ok, fail",
		},
		{ label: "These", slug: "guides/these", href: "/guides/these/", desc: "Left, right, or both values at once" },
		{ label: "Pair", slug: "guides/pair", href: "/guides/pair/", desc: "Two-element ordered tuple helpers" },
	],
}, {
	id: "p-async",
	kind: "group",
	label: "Async",
	items: [
		{ label: "Task", slug: "guides/task", href: "/guides/task/", desc: "Lazy, cancellable async computations" },
		{
			label: "Op",
			slug: "guides/op",
			href: "/guides/op/",
			desc: "Stateful managed async operations with overlap policies",
		},
		{
			label: "Deferred",
			slug: "guides/deferred",
			href: "/guides/deferred/",
			desc: "Single-assignment async synchronization latch",
		},
		{
			label: "Aborted",
			slug: "guides/aborted",
			href: "/guides/aborted/",
			desc: "Cancellation token and abort signal helpers",
		},
		{
			label: "EventBus",
			slug: "guides/event-bus",
			href: "/guides/event-bus/",
			desc: "Typed publish/subscribe channel with forwarding",
		},
		{
			label: "Batcher",
			slug: "guides/batcher",
			href: "/guides/batcher/",
			desc: "Coalesce and deduplicate concurrent keyed lookups",
		},
		{
			label: "Cache",
			slug: "guides/cache",
			href: "/guides/cache/",
			desc: "In-memory cache with TTL, SWR, and stampede protection",
		},
		{
			label: "CircuitBreaker",
			slug: "guides/circuit-breaker",
			href: "/guides/circuit-breaker/",
			desc: "Trip open on sustained failures and probe recovery",
		},
		{
			label: "RateLimiter",
			slug: "guides/rate-limiter",
			href: "/guides/rate-limiter/",
			desc: "Token-bucket request throttling",
		},
		{
			label: "Resource",
			slug: "guides/resource",
			href: "/guides/resource/",
			desc: "Scoped resource acquisition and guaranteed LIFO release",
		},
		{ label: "Pool", slug: "guides/pool", href: "/guides/pool/", desc: "Bounded pool of reusable resources" },
		{
			label: "Supervisor",
			slug: "guides/supervisor",
			href: "/guides/supervisor/",
			desc: "Managed background tasks with restart policies",
		},
		{
			label: "Transaction",
			slug: "guides/transaction",
			href: "/guides/transaction/",
			desc: "Multi-step saga with reverse compensation on failure",
		},
		{
			label: "Graph",
			slug: "guides/graph",
			href: "/guides/graph/",
			desc: "Execute dependency DAGs concurrently in topological order",
		},
	],
}, {
	id: "p-state",
	kind: "group",
	label: "State & context",
	items: [
		{
			label: "Machine",
			slug: "guides/machine",
			href: "/guides/machine/",
			desc: "Finite state machines with typed transitions and effects",
		},
		{ label: "State", slug: "guides/state", href: "/guides/state/", desc: "Thread immutable state through pure steps" },
		{
			label: "Reader",
			slug: "guides/reader",
			href: "/guides/reader/",
			desc: "Pass shared configuration down a pipeline",
		},
		{
			label: "Logged",
			slug: "guides/logged",
			href: "/guides/logged/",
			desc: "Accumulate structured trace entries alongside a value",
		},
	],
}, {
	id: "p-comp",
	kind: "group",
	label: "Comparing & types",
	items: [
		{
			label: "Equality",
			slug: "guides/equality",
			href: "/guides/equality/",
			desc: "Composable structural equality checks",
		},
		{ label: "Ordering", slug: "guides/ordering", href: "/guides/ordering/", desc: "Sort with composable comparators" },
		{
			label: "Predicate",
			slug: "guides/predicate",
			href: "/guides/predicate/",
			desc: "Combine and negate boolean checks",
		},
		{
			label: "Refinement",
			slug: "guides/refinement",
			href: "/guides/refinement/",
			desc: "Compose TypeScript type guards safely",
		},
		{
			label: "Combinable",
			slug: "guides/combinable",
			href: "/guides/combinable/",
			desc: "Merge values of the same type with combine",
		},
		{ label: "Brand", slug: "guides/brand", href: "/guides/brand/", desc: "Zero-cost nominal wrapper types" },
		{
			label: "Duration",
			slug: "guides/duration",
			href: "/guides/duration/",
			desc: "Explicit units of time without bare numbers",
		},
		{
			label: "Policies",
			slug: "guides/policies",
			href: "/guides/policies/",
			desc: "Retry, repeat, and timeout policy combinators",
		},
		{
			label: "NonEmpty",
			slug: "guides/nonempty",
			href: "/guides/nonempty/",
			desc: "Type-enforced non-empty arrays, sets, strings, and records",
		},
	],
}, {
	id: "p-optics",
	kind: "group",
	label: "Optics",
	items: [{
		label: "Lens",
		slug: "guides/lens",
		href: "/guides/lens/",
		desc: "Read and immutably update nested object fields",
	}, {
		label: "Optional",
		slug: "guides/optional",
		href: "/guides/optional/",
		desc: "Focus and update fields that may be absent",
	}],
}, {
	id: "p-data",
	kind: "group",
	label: "Data & collections",
	items: [
		{
			label: "Arr",
			slug: "guides/arr",
			href: "/guides/arr/",
			desc: "Partition, index, and transform arrays without mutations",
		},
		{ label: "Rec", slug: "guides/rec", href: "/guides/rec/", desc: "Transform and inspect plain records" },
		{ label: "Dict", slug: "guides/dict", href: "/guides/dict/", desc: "Typed key-value dictionary backed by Map" },
		{ label: "Uniq", slug: "guides/uniq", href: "/guides/uniq/", desc: "Immutable unique set operations" },
		{ label: "Str", slug: "guides/str", href: "/guides/str/", desc: "Curried string helpers and grapheme sizing" },
		{
			label: "Num",
			slug: "guides/num",
			href: "/guides/num/",
			desc: "Safe numeric conversions, clamping, and statistics",
		},
		{ label: "BigNum", slug: "guides/bignum", href: "/guides/bignum/", desc: "BigInt arithmetic and conversions" },
		{ label: "Bool", slug: "guides/bool", href: "/guides/bool/", desc: "Boolean branching and logical helpers" },
		{
			label: "Json",
			slug: "guides/json",
			href: "/guides/json/",
			desc: "Typed JSON parsing and serialization with Result",
		},
	],
}, {
	id: "p-react",
	kind: "group",
	label: "React",
	items: [{
		label: "Overview",
		slug: "guides/react-bindings",
		href: "/guides/react-bindings/",
		desc: "@pplnd/react lifecycle hook overview",
	}, {
		label: "useLoad",
		slug: "guides/use-load",
		href: "/guides/use-load/",
		desc: "Load remote data into React with cancellation",
	}, {
		label: "useOp",
		slug: "guides/use-op",
		href: "/guides/use-op/",
		desc: "Bind imperative Op managers to React state",
	}, {
		label: "useOpPoll",
		slug: "guides/use-op-poll",
		href: "/guides/use-op-poll/",
		desc: "Poll an Op on an explicit interval inside components",
	}, {
		label: "useMachine",
		slug: "guides/use-machine",
		href: "/guides/use-machine/",
		desc: "Subscribe a component to a Machine interpreter",
	}, {
		label: "useActor",
		slug: "guides/use-actor",
		href: "/guides/use-actor/",
		desc: "Spawn and scope a local actor per component lifecycle",
	}, {
		label: "useEventBus",
		slug: "guides/use-event-bus",
		href: "/guides/use-event-bus/",
		desc: "Subscribe cleanly to EventBus topics inside React",
	}, {
		label: "useResource",
		slug: "guides/use-resource",
		href: "/guides/use-resource/",
		desc: "Acquire and release a Resource across mount/unmount",
	}],
}, {
	id: "p-appendix",
	kind: "group",
	label: "Appendix",
	items: [{
		label: "Design notes",
		slug: "appendix/design-notes",
		href: "/appendix/design-notes/",
		desc: "Architectural trade-offs and design philosophy",
	}, {
		label: "Benchmarks",
		slug: "appendix/benchmarks",
		href: "/appendix/benchmarks/",
		desc: "Measured data-module loops vs native JS methods",
	}, {
		label: "Contributor handbook",
		slug: "contributing",
		href: "/contributing/",
		desc: "How to set up, test, and contribute",
	}, {
		label: "Local workflow",
		slug: "contributing/workflow",
		href: "/contributing/workflow/",
		desc: "Day-to-day verification and pull requests",
	}, {
		label: "Testing",
		slug: "contributing/testing",
		href: "/contributing/testing/",
		desc: "Runtime, type-level, coverage, and benchmark suites",
	}, {
		label: "Adding a module",
		slug: "contributing/modules",
		href: "/contributing/modules/",
		desc: "Module anatomy, naming rules, and checklist",
	}, {
		label: "Writing guides",
		slug: "contributing/writing",
		href: "/contributing/writing/",
		desc: "Documentation voice, anatomy, and cross-links",
	}],
}, {
	id: "p-api",
	kind: "link",
	label: "API",
	slug: "api/readme",
	href: "/api/readme/",
	desc: "Generated TypeDoc reference for @pplnd/core",
}];

export const SEARCH_ITEMS: readonly SearchEntry[] = NAV_ENTRIES.flatMap((entry) =>
	entry.kind === "group"
		? entry.items.map((item) => ({ label: item.label, href: item.href, section: entry.label, desc: item.desc ?? "" }))
		: [{ label: entry.label, href: entry.href, section: "API Reference", desc: entry.desc ?? "" }]
);

export const TICKER_NAMES: readonly string[] = [
	"Maybe",
	"Result",
	"Validation",
	"RemoteData",
	"These",
	"Task",
	"Op",
	"Deferred",
	"Aborted",
	"EventBus",
	"Batcher",
	"Cache",
	"CircuitBreaker",
	"RateLimiter",
	"Resource",
	"Pool",
	"Supervisor",
	"Transaction",
	"Graph",
	"Machine",
	"State",
	"Reader",
	"Logged",
	"Pair",
	"Equality",
	"Ordering",
	"Predicate",
	"Refinement",
	"Combinable",
	"Lens",
	"Optional",
	"Arr",
	"Rec",
	"Dict",
	"Uniq",
	"Str",
	"Num",
	"BigNum",
	"Bool",
	"Json",
	"Brand",
	"Duration",
	"useLoad",
	"useOp",
	"useMachine",
	"useResource",
];

export const HOME_CARDS: readonly HomeCard[] = [{
	meta: "Result",
	title: "Model typed failures as values, branch safely, and recover inline",
	href: "/guides/result/",
	variant: "branch",
	svgBody:
		'<g><path d="M28 65 H92 L138 33 H198 M92 65 L138 97 H198"/><circle cx="92" cy="65" r="4" style="fill:currentColor"/></g><text x="208" y="33" dominant-baseline="central">Ok</text><text x="208" y="97" dominant-baseline="central">Err</text>',
}, {
	meta: "Task",
	title: "Compose lazy, cancellable async work with parallel combinators",
	href: "/guides/task/",
	variant: "parallel",
	svgBody:
		'<g><path d="M24 65 H64 V33 H206 V65 H246 M64 65 V97 H206 V65"/><circle cx="64" cy="65" r="4" style="fill:currentColor"/><circle cx="206" cy="65" r="4" style="fill:currentColor"/></g><rect x="101" y="22" width="68" height="22" style="fill:var(--pplnd-plate)"/><rect x="101" y="86" width="68" height="22" style="fill:var(--pplnd-plate)"/><text x="135" y="33" text-anchor="middle" dominant-baseline="central" class="small">Task A</text><text x="135" y="97" text-anchor="middle" dominant-baseline="central" class="small">Task B</text>',
}, {
	meta: "Op",
	title: "Manage overlapping async runs: restart, queue, debounce, retry, and poll",
	href: "/guides/op/",
	variant: "operation",
	svgRole: "img",
	svgLabel: "In restartable mode, the second run replaces the first and finishes.",
	svgBody:
		'<g><path d="M88 43 H140 M150 37 L162 49 M150 49 L162 37 M156 56 V79"/><path d="M156 87 H248 M240 80 L248 87 L240 94"/><circle cx="88" cy="43" r="4" style="fill:currentColor"/><circle cx="156" cy="87" r="4" style="fill:currentColor"/></g><text x="78" y="43" text-anchor="end" dominant-baseline="central">run 1</text><text x="146" y="87" text-anchor="end" dominant-baseline="central">run 2</text>',
}, {
	meta: "EventBus",
	title: "Deliver typed pub-sub events with ordered sequences and re-entrant queues",
	href: "/guides/event-bus/",
	variant: "bus",
	svgRole: "img",
	svgLabel: "One emitted event reaches three listeners.",
	svgBody:
		'<g><path d="M80 65 H144 M144 27 V103 M144 27 H232 M144 65 H232 M144 103 H232"/><circle cx="238" cy="27" r="6"/><circle cx="238" cy="65" r="6"/><circle cx="238" cy="103" r="6"/></g><text x="26" y="65" dominant-baseline="central">emit</text>',
}, {
	meta: "Machine",
	title: "Model finite state machines with guarded transitions and async effects",
	href: "/guides/machine/",
	variant: "state",
	svgBody:
		'<g><path d="M70 53 H198 M190 46 L198 53 L190 60 M206 71 Q135 123 64 71 M68 82 L64 71 L76 73"/><circle cx="46" cy="53" r="24"/><circle cx="224" cy="53" r="24"/></g><text x="46" y="53" text-anchor="middle" dominant-baseline="central" class="small">idle</text><text x="224" y="53" text-anchor="middle" dominant-baseline="central" class="small">busy</text>',
}, {
	meta: "Graph",
	title: "Execute dependency DAGs in topological order with fail-fast cancellation",
	href: "/guides/graph/",
	variant: "graph",
	svgRole: "img",
	svgLabel: "Two checks depend on the same input. Both must finish before the final node can start.",
	svgBody:
		'<g><path d="M36 65 L122 31 L208 65 H243 M36 65 L122 99 L208 65"/><path d="M236 58 L243 65 L236 72"/><circle cx="36" cy="65" r="9"/><circle cx="122" cy="31" r="9"/><circle cx="122" cy="99" r="9"/><circle cx="208" cy="65" r="9"/></g>',
}, {
	meta: "Resource",
	title: "Acquire scoped resources safely and release in guaranteed reverse order",
	href: "/guides/resource/",
	variant: "resource",
	svgRole: "img",
	svgLabel: "Resource A holds resource B. B is released before A.",
	svgBody:
		'<g><path d="M29 26 V104 H241 V26 M67 48 V82 H203 V48"/><circle cx="29" cy="26" r="4" style="fill:currentColor"/><circle cx="67" cy="48" r="4" style="fill:currentColor"/><path d="M197 55 L203 48 L209 55 M235 33 L241 26 L247 33"/></g><text x="41" y="26" dominant-baseline="central" class="small">A</text><text x="79" y="48" dominant-baseline="central" class="small">B</text>',
}, {
	meta: "Batcher",
	title: "Coalesce concurrent keyed lookups and deduplicate identical requests",
	href: "/guides/batcher/",
	variant: "batch",
	svgRole: "img",
	svgLabel: "Three lookups for A, B, and A become one bulk request for A and B.",
	svgBody:
		'<text x="28" y="28" text-anchor="middle" dominant-baseline="central">A</text><text x="28" y="65" text-anchor="middle" dominant-baseline="central">B</text><text x="28" y="102" text-anchor="middle" dominant-baseline="central">A</text><g><path d="M48 28 H76 L112 65 H158 M48 65 H112 M48 102 H76 L112 65 M150 58 L158 65 L150 72"/><rect x="168" y="41" width="80" height="48"/></g><text x="208" y="65" text-anchor="middle" dominant-baseline="central">A, B</text>',
}, {
	meta: "Cache",
	title: "Cache async lookups with TTL expiration, SWR, and stampede protection",
	href: "/guides/cache/",
	variant: "cache",
	svgRole: "img",
	svgLabel: "A first lookup loads the value. A second lookup for the same key reuses it.",
	svgBody:
		'<g><path d="M36 48 H121 M113 41 L121 48 L113 55 M149 82 H234 M226 75 L234 82 L226 89"/><rect x="125" y="28" width="20" height="74"/></g><text x="76" y="34" text-anchor="middle" class="small">load</text><text x="194" y="68" text-anchor="middle" class="small">reuse</text>',
}, {
	meta: "Lens",
	title: "Focus, read, and immutably update deeply nested object fields",
	href: "/guides/lens/",
	variant: "lens",
	svgBody:
		'<g><rect x="26" y="25" width="142" height="80"/><rect x="50" y="41" width="94" height="48"/><path d="M144 65 H244 M236 58 L244 65 L236 72"/></g><text x="97" y="65" text-anchor="middle" dominant-baseline="central">city</text>',
}, {
	meta: "Arr",
	title: "Filter, partition, group, and transform arrays without mutation",
	href: "/guides/arr/",
	variant: "array",
	svgRole: "img",
	svgLabel: "groupBy separates a mixed collection into circles and squares",
	svgBody:
		'<g><circle cx="28" cy="65" r="7"/><rect x="46" y="58" width="14" height="14"/><circle cx="78" cy="65" r="7"/><rect x="96" y="58" width="14" height="14"/><path d="M121 65 H140 L172 34 H199 M140 65 L172 96 H199"/><circle cx="216" cy="34" r="7"/><circle cx="241" cy="34" r="7"/><rect x="209" y="89" width="14" height="14"/><rect x="234" y="89" width="14" height="14"/></g>',
}, {
	meta: "Ordering",
	title: "Sort collections with composable, multi-key, and reverse comparators",
	href: "/guides/ordering/",
	variant: "order",
	svgRole: "img",
	svgLabel: "Sorting 9, 2, 5 into ascending order",
	svgBody:
		'<g aria-hidden="true"><path d="M46 28 H70 C114 28 156 102 200 102 H224"/><path d="M46 65 H70 C114 65 156 28 200 28 H224 M46 102 H70 C114 102 156 65 200 65 H224"/></g><text x="29" y="28" text-anchor="middle" dominant-baseline="central">9</text><text x="29" y="65" text-anchor="middle" dominant-baseline="central">2</text><text x="29" y="102" text-anchor="middle" dominant-baseline="central">5</text><text x="241" y="28" text-anchor="middle" dominant-baseline="central">2</text><text x="241" y="65" text-anchor="middle" dominant-baseline="central">5</text><text x="241" y="102" text-anchor="middle" dominant-baseline="central">9</text>',
}];
