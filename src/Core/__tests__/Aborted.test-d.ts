import { expectTypeOf, test } from "vitest";
import { Aborted } from "../Aborted.ts";

test("make: returns a typed Aborted outcome", () => {
	expectTypeOf(Aborted.make("cancelled")).toEqualTypeOf<Aborted>();
});

test("make: accepts any reason type", () => {
	expectTypeOf(Aborted.make({ code: "TIMEOUT" })).toEqualTypeOf<Aborted>();
	expectTypeOf(Aborted.make()).toEqualTypeOf<Aborted>();
});

test("is: narrows a discriminated value to Aborted", () => {
	const value: { readonly kind: string; } = Aborted.make(undefined);
	if (Aborted.is(value)) {
		expectTypeOf(value).toEqualTypeOf<Aborted>();
		expectTypeOf(value.reason).toEqualTypeOf<unknown>();
	}
});
