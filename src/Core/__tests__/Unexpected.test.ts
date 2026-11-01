import { expect, test } from "vitest";
import { Unexpected } from "../Unexpected.ts";

test("make.execution: constructs execution variant with defaults", () => {
	const cause = new Error("db failure");
	const err = Unexpected.make.execution({ source: "Batcher", cause });

	expect(err).toStrictEqual({ kind: "Unexpected", source: "Batcher", phase: "execution", cause });
});

test("make.execution: preserves explicit phase and stepId", () => {
	const cause = "timeout";
	const err = Unexpected.make.execution({ source: "Transaction", phase: "use", cause, stepId: "step-1" });

	expect(err).toStrictEqual({ kind: "Unexpected", source: "Transaction", phase: "use", cause, stepId: "step-1" });
});

test("make.release: constructs release variant with default additionalErrors", () => {
	const cause = new Error("close failed");
	const previous = { status: 500 };
	const err = Unexpected.make.release({ cause, previous });

	expect(err).toStrictEqual({
		kind: "Unexpected",
		source: "Resource",
		phase: "release",
		cause,
		previous,
		additionalErrors: [],
	});
});

test("make.release: retains explicit additionalErrors", () => {
	const cause = new Error("primary cleanup");
	const secondary = new Error("secondary cleanup");
	const err = Unexpected.make.release({ cause, previous: null, additionalErrors: [secondary] });

	expect(err).toStrictEqual({
		kind: "Unexpected",
		source: "Resource",
		phase: "release",
		cause,
		previous: null,
		additionalErrors: [secondary],
	});
});

test("is.unexpected: identifies Unexpected values", () => {
	const exec = Unexpected.make.execution({ source: "Test", cause: "fail" });
	const rel = Unexpected.make.release({ cause: "rel-fail", previous: 123 });

	expect(Unexpected.is.unexpected(exec)).toBe(true);
	expect(Unexpected.is.unexpected(rel)).toBe(true);
	expect(Unexpected.is.unexpected(null)).toBe(false);
	expect(Unexpected.is.unexpected(undefined)).toBe(false);
	expect(Unexpected.is.unexpected({ kind: "Other" })).toBe(false);
	expect(Unexpected.is.unexpected("Unexpected")).toBe(false);
});

test("is.unexpected: rejects incomplete and malformed variants", () => {
	const invalid: unknown[] = [
		{ kind: "Unexpected" },
		{ kind: "Unexpected", source: 1, phase: "execution", cause: undefined },
		{ kind: "Unexpected", source: "Task", phase: "execution" },
		{ kind: "Unexpected", source: "Task", phase: "other", cause: null },
		{ kind: "Unexpected", source: "Task", phase: "execution", cause: null, stepId: 1 },
		{ kind: "Unexpected", source: "Task", phase: "release", cause: null, previous: 1, additionalErrors: [] },
		{ kind: "Unexpected", source: "Resource", phase: "release", cause: null, additionalErrors: [] },
		{ kind: "Unexpected", source: "Resource", phase: "release", cause: null, previous: 1, additionalErrors: null },
	];
	for (const value of invalid) {
		expect(Unexpected.is.unexpected(value)).toBe(false);
	}
	expect(Unexpected.is.unexpected({ kind: "Unexpected", source: "Task", phase: "use", cause: undefined })).toBe(true);
});

test("is.execution: identifies execution phases", () => {
	const exec = Unexpected.make.execution({ source: "Test", cause: "fail" });
	const acquire = Unexpected.make.execution({ source: "Resource", phase: "acquire", cause: "fail" });
	const rel = Unexpected.make.release({ cause: "rel-fail", previous: 123 });

	expect(Unexpected.is.execution(exec)).toBe(true);
	expect(Unexpected.is.execution(acquire)).toBe(true);
	expect(Unexpected.is.execution(rel)).toBe(false);
	expect(Unexpected.is.execution({})).toBe(false);
});

test("is.release: identifies release phase", () => {
	const exec = Unexpected.make.execution({ source: "Test", cause: "fail" });
	const rel = Unexpected.make.release({ cause: "rel-fail", previous: 123 });

	expect(Unexpected.is.release(exec)).toBe(false);
	expect(Unexpected.is.release(rel)).toBe(true);
	expect(Unexpected.is.release(null)).toBe(false);
});

test("match: eliminates unexpected values by variant", () => {
	const exec = Unexpected.make.execution({ source: "Graph", cause: "cycle" });
	const rel = Unexpected.make.release({ cause: "leak", previous: "prev" });

	const matcher = Unexpected.match({
		execution: (e) => `exec:${e.source}:${String(e.cause)}`,
		release: (r) => `rel:${String(r.previous)}:${String(r.cause)}`,
	});

	expect(matcher(exec)).toBe("exec:Graph:cycle");
	expect(matcher(rel)).toBe("rel:prev:leak");
});
