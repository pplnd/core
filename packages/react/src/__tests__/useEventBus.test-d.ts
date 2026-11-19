import { EventBus } from "@pplnd/core";
import { expectTypeOf, test } from "vitest";
import { useEventBus } from "../useEventBus.ts";

type CartEvents = { readonly itemAdded: { readonly id: string; }; readonly cartCleared: number; };

declare const bus: EventBus<CartEvents>;

test("useEventBus: handler payloads are typed exactly per key", () => {
	expectTypeOf(useEventBus(bus, "itemAdded", (payload) => {
		expectTypeOf(payload).toEqualTypeOf<{ readonly id: string; }>();
	})).toEqualTypeOf<void>();
	expectTypeOf(useEventBus(bus, "cartCleared", (value) => {
		expectTypeOf(value).toEqualTypeOf<number>();
	})).toEqualTypeOf<void>();
});

test("useEventBus: rejects invalid keys and mismatched payload handlers", () => {
	expectTypeOf(useEventBus(bus, "itemAdded", () => {})).toEqualTypeOf<void>();
	// @ts-expect-error an unknown event kind is rejected
	useEventBus(bus, "itemRemoved", () => {});
	// @ts-expect-error the handler must accept the key's payload type
	useEventBus(bus, "itemAdded", (payload: { readonly wrong: true; }) => {
		void payload;
	});
});
