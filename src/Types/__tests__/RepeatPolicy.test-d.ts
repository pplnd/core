import { describe, expectTypeOf, it } from "vitest";
import { Duration } from "../Duration.ts";
import { RepeatPolicy } from "../RepeatPolicy.ts";

describe("RepeatPolicy type-level tests", () => {
	it("types both cadence factories as RepeatPolicy with a Duration delay", () => {
		const spacing = RepeatPolicy.spacing({ every: Duration.seconds(5), jitter: true });
		expectTypeOf(spacing).toEqualTypeOf<RepeatPolicy>();
		expectTypeOf(spacing.getDelay({ tick: 1, elapsed: Duration.seconds(2) })).toEqualTypeOf<Duration>();

		const cadence = RepeatPolicy.cadence({ every: Duration.seconds(5) });
		expectTypeOf(cadence).toEqualTypeOf<RepeatPolicy>();
	});

	it("types the Tick scheduling context", () => {
		expectTypeOf<RepeatPolicy.Tick>().toEqualTypeOf<{ readonly tick: number; readonly elapsed: Duration; }>();
	});

	it("rejects a raw number in place of the `every` duration", () => {
		// @ts-expect-error raw number passed instead of Duration
		expectTypeOf(RepeatPolicy.spacing({ every: 5000 })).toBeObject();
	});
});
