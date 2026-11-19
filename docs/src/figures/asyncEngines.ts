import type { HeroFigureSpec } from "./types";

export const ASYNC_ENGINE_FIGURES: Record<string, HeroFigureSpec> = {
	"guides/task": {
		plate: "#dcefb8",
		title: "Parallel fork-join execution in Task",
		desc: "Task forks concurrent branches from a starting trigger and joins their settled results downstream.",
		caption: "Task · Lazy, cancellable async pipelines",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M-8 128 H140 V66 H430 V128 H548 M140 128 V190 H430 V128" />
				<path d="M538 118 L548 128 L538 138" />
				<circle cx="140" cy="128" r="5" fill="currentColor" />
				<circle cx="430" cy="128" r="5" fill="currentColor" />
			</g>
			<text x="20" y="112" class="flow-input">run</text>
			<text x="220" y="50" class="flow-label">Task.Result A</text>
			<text x="220" y="220" class="flow-label">Task.Result B</text>
			<text x="454" y="112" class="flow-value">[a, b]</text>
		`,
	},
	"guides/op": {
		plate: "#f6cbb7",
		title: "Overlap control in Op",
		desc: "In restartable mode, starting run 2 immediately settles run 1 as replaced and executes run 2 to completion.",
		caption: "Op · Managed async runs and overlap strategies",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M126 78 H276 M292 68 L312 88 M292 88 L312 68 M302 98 V156" />
				<path d="M302 170 H540 M530 160 L540 170 L530 180" />
				<circle cx="126" cy="78" r="5" fill="currentColor" />
				<circle cx="302" cy="170" r="5" fill="currentColor" />
			</g>
			<text x="110" y="78" text-anchor="end" dominant-baseline="central" class="flow-label">run 1</text>
			<text x="330" y="78" dominant-baseline="central" class="flow-value">OpNil("replaced")</text>
			<text x="286" y="170" text-anchor="end" dominant-baseline="central" class="flow-label">run 2</text>
			<text x="476" y="148" class="flow-value">OpOk</text>
		`,
	},
	"guides/deferred": {
		plate: "#c5daf6",
		title: "Single-assignment synchronization latch in Deferred",
		desc:
			"Multiple awaiting callers suspend on a Deferred latch until one caller writes a result, waking every waiter together.",
		caption: "Deferred · Write-once latch shared across awaiters",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M24 128 H248" />
				<path d="M288 128 L376 68 H520 M288 128 H520 M288 128 L376 188 H520" />
				<path d="M510 58 L520 68 L510 78 M510 118 L520 128 L510 138 M510 178 L520 188 L510 198" />
				<circle cx="268" cy="128" r="24" class="flow-node" />
			</g>
			<text x="24" y="110" class="flow-value">succeed(val)</text>
			<text x="434" y="54" class="flow-tag">waiter 1</text>
			<text x="434" y="114" class="flow-tag">waiter 2</text>
			<text x="434" y="174" class="flow-tag">all settled</text>
		`,
	},
	"guides/aborted": {
		plate: "#f2c6d8",
		title: "Separating cancellation from domain errors with Aborted",
		desc: "Domain errors enter Result.mapError for operator messages while Aborted passes straight through unchanged.",
		caption: "Aborted · Cancellation bypasses application error mapping",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M-8 128 H182 L254 68 H540 M182 128 L254 188 H540" />
				<path d="M530 58 L540 68 L530 78 M530 178 L540 188 L530 198" />
				<rect x="292" y="42" width="144" height="52" class="flow-node" />
				<circle cx="182" cy="128" r="5" fill="currentColor" />
			</g>
			<text x="24" y="112" class="flow-input">settle</text>
			<text x="364" y="68" text-anchor="middle" dominant-baseline="central" class="flow-value">mapError</text>
			<text x="456" y="116" class="flow-value">operator err</text>
			<text x="292" y="216" class="flow-value">Aborted · pass through</text>
		`,
	},
	"guides/event-bus": {
		plate: "#b8e6d8",
		title: "Sequential FIFO fan-out in EventBus",
		desc:
			"An emitted message distributes down a bus bar to active listeners while re-entrant emissions wait in the FIFO queue.",
		caption: "EventBus · Typed fan-out with queued re-entrant emits",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M138 128 H292 M292 52 V204 M292 52 H494 M292 128 H494 M292 204 H494" />
				<circle cx="508" cy="52" r="14" class="flow-node" />
				<circle cx="508" cy="128" r="14" class="flow-node" />
				<circle cx="508" cy="204" r="14" class="flow-node" />
			</g>
			<text x="122" y="128" text-anchor="end" dominant-baseline="central" class="flow-input">emit</text>
			<text x="320" y="40" class="flow-value">listener A</text>
			<text x="320" y="116" class="flow-value">listener B</text>
			<text x="320" y="192" class="flow-value">queued re-emit</text>
		`,
	},
	"guides/batcher": {
		plate: "#f7dfa8",
		title: "Keyed request coalescing and deduplication in Batcher",
		desc:
			"Three separate requests for A, B, and A collapse into one bulk lookup for unique keys [A, B] and fan back out.",
		caption: "Batcher · Merge and deduplicate concurrent keyed lookups",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M84 56 H148 L228 128 H326 M84 128 H228 M84 200 H148 L228 128 M316 118 L326 128 L316 138" />
				<rect x="336" y="76" width="184" height="104" class="flow-node" />
			</g>
			<text x="68" y="56" text-anchor="end" dominant-baseline="central" class="flow-input">A</text>
			<text x="68" y="128" text-anchor="end" dominant-baseline="central" class="flow-input">B</text>
			<text x="68" y="200" text-anchor="end" dominant-baseline="central" class="flow-input">A</text>
			<text x="428" y="128" text-anchor="middle" dominant-baseline="central" class="flow-input">["A", "B"]</text>
		`,
	},
	"guides/cache": {
		plate: "#c7e3b5",
		title: "Stale-while-revalidate and stampede deduplication in Cache",
		desc: "First lookup misses through the loader into storage while repeated lookups read directly from the cache gate.",
		caption: "Cache · Load once, serve fresh or refresh in background",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M40 86 H244 M232 75 L244 86 L232 97" />
				<path d="M300 170 H540 M528 159 L540 170 L528 181" />
				<rect x="248" y="44" width="50" height="168" class="flow-node" />
			</g>
			<text x="40" y="66" class="flow-label">miss -> load</text>
			<text x="338" y="148" class="flow-label">hit -> reuse value</text>
		`,
	},
	"guides/circuit-breaker": {
		plate: "#f7d4bc",
		title: "Three states of CircuitBreaker",
		desc:
			"CircuitBreaker starts Closed, opens after threshold failures, waits out cooldown to enter HalfOpen, and closes if a probe succeeds.",
		caption: "CircuitBreaker · Trip open on failures, probe after cooldown",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M156 128 H234 M224 118 L234 128 L224 138" />
				<path d="M366 128 H444 M434 118 L444 128 L434 138" />
				<path d="M498 184 Q300 242 102 184 M110 198 L102 184 L119 182" />
				<circle cx="96" cy="128" r="56" class="flow-node" />
				<circle cx="300" cy="128" r="56" class="flow-node" />
				<circle cx="504" cy="128" r="56" class="flow-node" />
			</g>
			<text x="96" y="128" text-anchor="middle" dominant-baseline="central" class="flow-label">Closed</text>
			<text x="300" y="128" text-anchor="middle" dominant-baseline="central" class="flow-label">Open</text>
			<text x="504" y="128" text-anchor="middle" dominant-baseline="central" class="flow-label">HalfOpen</text>
			<text x="300" y="238" text-anchor="middle" class="flow-tag">probe ok</text>
		`,
	},
	"guides/rate-limiter": {
		plate: "#e6dec8",
		title: "Token-bucket request throttling in RateLimiter",
		desc: "Concurrent burst callers pass through an admission gate paced by available permits over a rolling window.",
		caption: "RateLimiter · Admit up to limit, queue surplus in order",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M66 72 H174 M66 128 H174 M66 184 H174" />
				<path d="M164 62 L174 72 L164 82 M164 118 L174 128 L164 138 M164 174 L174 184 L164 194" />
				<rect x="176" y="48" width="104" height="160" class="flow-node" />
				<path d="M280 128 H554 M544 118 L554 128 L544 138" />
				<circle cx="344" cy="128" r="18" class="flow-node" />
				<circle cx="416" cy="128" r="18" class="flow-node" />
				<circle cx="488" cy="128" r="18" class="flow-node" />
			</g>
			<text x="66" y="48" class="flow-tag">burst</text>
			<text x="228" y="114" text-anchor="middle" dominant-baseline="central" class="flow-value">limit</text>
			<text x="228" y="144" text-anchor="middle" dominant-baseline="central" class="flow-tag">/ window</text>
			<text x="416" y="82" text-anchor="middle" class="flow-value">paced interval</text>
			<text x="344" y="128" text-anchor="middle" dominant-baseline="central" class="flow-tag">1</text>
			<text x="416" y="128" text-anchor="middle" dominant-baseline="central" class="flow-tag">2</text>
			<text x="488" y="128" text-anchor="middle" dominant-baseline="central" class="flow-tag">3</text>
		`,
	},
	"guides/resource": {
		plate: "#f2c6d8",
		title: "Nested acquisition and reverse LIFO release in Resource",
		desc: "Resource A opens first, then Resource B opens inside it; on scope exit or failure, B releases before A.",
		caption: "Resource · Pair setup with guaranteed LIFO cleanup",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M64 46 V206 H536 V46 M148 92 V164 H452 V92" />
				<circle cx="64" cy="46" r="5" fill="currentColor" />
				<circle cx="148" cy="92" r="5" fill="currentColor" />
				<path d="M442 104 L452 92 L462 104 M526 58 L536 46 L546 58" />
			</g>
			<text x="82" y="46" dominant-baseline="central" class="flow-label">acquire A</text>
			<text x="166" y="92" dominant-baseline="central" class="flow-label">acquire B</text>
			<text x="426" y="92" text-anchor="end" dominant-baseline="central" class="flow-value">release B</text>
			<text x="510" y="46" text-anchor="end" dominant-baseline="central" class="flow-value">release A</text>
		`,
	},
	"guides/pool": {
		plate: "#bce5f5",
		title: "Bounded lease pool with wait queue in Pool",
		desc:
			"Callers acquire reusable slots up to maxSize while surplus callers wait in FIFO order and released items wake the next waiter.",
		caption: "Pool · Bounded capacity with queued waiters",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M44 76 H174 M44 126 H174 M44 192 H174" />
				<path d="M164 66 L174 76 L164 86 M164 116 L174 126 L164 136 M164 182 L174 192 L164 202" />
				<rect x="176" y="44" width="212" height="114" class="flow-node" />
				<rect x="196" y="60" width="172" height="32" class="flow-node" />
				<rect x="196" y="110" width="172" height="32" class="flow-node" />
				<rect x="176" y="170" width="212" height="44" class="flow-node flow-dash" />
				<path d="M388 100 H552 M542 90 L552 100 L542 110" />
				<path d="M470 100 V192 H388 M398 182 L388 192 L398 202" />
				<circle cx="470" cy="100" r="4" fill="currentColor" />
			</g>
			<text x="44" y="54" class="flow-tag">callers</text>
			<text x="282" y="30" text-anchor="middle" class="flow-tag">maxSize: 2</text>
			<text x="282" y="76" text-anchor="middle" dominant-baseline="central" class="flow-tag">slot 1 · leased</text>
			<text x="282" y="126" text-anchor="middle" dominant-baseline="central" class="flow-tag">slot 2 · leased</text>
			<text x="282" y="192" text-anchor="middle" dominant-baseline="central" class="flow-tag">wait queue (FIFO)</text>
			<text x="470" y="78" text-anchor="middle" class="flow-tag">use &amp; release</text>
			<text x="470" y="216" text-anchor="middle" class="flow-tag">wake next</text>
		`,
	},
	"guides/supervisor": {
		plate: "#d9ccf3",
		title: "Managed worker restart lifecycle in Supervisor",
		desc:
			"A supervised worker runs its task loop, enters backoff when it crashes, and restarts cleanly under shutdown bounds.",
		caption: "Supervisor · Restart crashed background workers on schedule",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M180 96 H414 M402 85 L414 96 L402 107" />
				<path d="M418 148 Q300 218 182 148 M190 164 L182 148 L199 152" />
				<circle cx="128" cy="112" r="52" class="flow-node" />
				<circle cx="470" cy="112" r="52" class="flow-node" />
			</g>
			<text x="128" y="112" text-anchor="middle" dominant-baseline="central" class="flow-label">Running</text>
			<text x="470" y="112" text-anchor="middle" dominant-baseline="central" class="flow-label">Backoff</text>
			<text x="298" y="76" text-anchor="middle" class="flow-value">crash / error</text>
			<text x="298" y="210" text-anchor="middle" class="flow-value">restart after delay</text>
		`,
	},
	"guides/transaction": {
		plate: "#f7d4bc",
		title: "Forward execution and reverse compensation in Transaction",
		desc:
			"When step 3 fails, Transaction runs registered undo handlers for steps 2 and 1 in reverse order and returns step 3's error.",
		caption: "Transaction · Forward steps, reverse undo on failure",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M30 82 H464 M478 72 L498 92 M478 92 L498 72" />
				<path d="M488 102 V174 H56 M66 164 L56 174 L66 184" />
				<rect x="86" y="56" width="96" height="52" class="flow-node" />
				<rect x="242" y="56" width="96" height="52" class="flow-node" />
			</g>
			<text x="134" y="82" text-anchor="middle" dominant-baseline="central" class="flow-value">step 1</text>
			<text x="290" y="82" text-anchor="middle" dominant-baseline="central" class="flow-value">step 2</text>
			<text x="514" y="82" dominant-baseline="central" class="flow-value">fail</text>
			<text x="290" y="202" text-anchor="middle" class="flow-value">undo 2</text>
			<text x="134" y="202" text-anchor="middle" class="flow-value">undo 1</text>
		`,
	},
	"guides/graph": {
		plate: "#bce5f5",
		title: "Concurrent diamond dependency execution in Graph",
		desc: "Root node outputs feed independent branches in parallel, joining only after every declared parent finishes.",
		caption: "Graph · Schedule dependencies concurrently in topological order",
		svg: `
			<g fill="none" stroke="currentColor" stroke-width="2">
				<path d="M126 128 L256 66 H344 L452 128 H544 M126 128 L256 190 H344 L452 128" />
				<path d="M534 118 L544 128 L534 138" />
				<circle cx="100" cy="128" r="28" class="flow-node" />
				<circle cx="300" cy="66" r="26" class="flow-node" />
				<circle cx="300" cy="190" r="26" class="flow-node" />
				<circle cx="452" cy="128" r="6" fill="currentColor" />
			</g>
			<text x="100" y="128" text-anchor="middle" dominant-baseline="central" class="flow-tag">in</text>
			<text x="300" y="66" text-anchor="middle" dominant-baseline="central" class="flow-tag">A</text>
			<text x="300" y="190" text-anchor="middle" dominant-baseline="central" class="flow-tag">B</text>
			<text x="488" y="108" class="flow-value">final</text>
		`,
	},
};
