import { expect, test } from "vitest";
import { Aborted } from "../Aborted.ts";

test("make: builds an Aborted outcome with the supplied reason", () => {
	expect(Aborted.make("user navigated away")).toStrictEqual({ kind: "Aborted", reason: "user navigated away" });
});

test("make: preserves undefined when no reason is supplied", () => {
	expect(Aborted.make()).toStrictEqual({ kind: "Aborted", reason: undefined });
});

test("make: preserves object and falsy reasons", () => {
	const reason = { code: "TIMEOUT" };
	expect(Aborted.make(reason).reason).toBe(reason);
	expect(Aborted.make(0).reason).toBe(0);
	expect(Aborted.make("").reason).toBe("");
	expect(Aborted.make(false).reason).toBe(false);
});

test("is: narrows an Aborted outcome", () => {
	const value: { readonly kind: string; } = Aborted.make("cancelled");
	expect(Aborted.is(value)).toBe(true);
	if (!Aborted.is(value)) {
		throw new Error("expected an Aborted outcome");
	}
	expect(value.reason).toBe("cancelled");
});

test("is: rejects other kinds", () => {
	expect(Aborted.is({ kind: "OpNil" })).toBe(false);
	expect(Aborted.is({ kind: "GraphAborted" })).toBe(false);
});
