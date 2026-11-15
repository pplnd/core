import { EventBus, type EventBus as EventBusType } from "@pplnd/core";
import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { useEventBus } from "../useEventBus.ts";

type CartEvents = { readonly itemAdded: { readonly id: string; }; readonly cartCleared: number; };

function busUnderTest() {
	const bus: EventBusType<CartEvents> = EventBus.make<CartEvents>();
	const added: Array<{ readonly id: string; }> = [];
	const cleared: number[] = [];
	return {
		bus,
		added,
		cleared,
		emitAdded: (id: string) => {
			EventBus.emit(bus, { kind: "itemAdded", value: { id } });
		},
		emitCleared: (count: number) => {
			EventBus.emit(bus, { kind: "cartCleared", value: count });
		},
	};
}

test("useEventBus: delivers event payloads to the handler", () => {
	const t = busUnderTest();
	renderHook(() => {
		useEventBus(t.bus, "itemAdded", (payload) => t.added.push(payload));
		useEventBus(t.bus, "cartCleared", (value) => t.cleared.push(value));
	});

	act(() => {
		t.emitAdded("a");
		t.emitCleared(2);
	});
	expect(t.added).toStrictEqual([{ id: "a" }]);
	expect(t.cleared).toStrictEqual([2]);
});

test("useEventBus: always observes the latest handler without re-subscribing", () => {
	const t = busUnderTest();
	let handlerId = 0;
	const seenFromFirst: Array<string> = [];
	const seenFromSecond: Array<string> = [];
	const { rerender } = renderHook(({ renderId }: { readonly renderId: number; }) => {
		handlerId = renderId;
		useEventBus(t.bus, "itemAdded", (payload) => {
			if (renderId === 1) {
				seenFromFirst.push(payload.id);
			} else {
				seenFromSecond.push(payload.id);
			}
		});
	}, { initialProps: { renderId: 1 } });

	act(() => {
		t.emitAdded("first");
	});
	rerender({ renderId: 2 });
	act(() => {
		t.emitAdded("second");
	});
	expect(seenFromFirst).toStrictEqual(["first"]);
	expect(seenFromSecond).toStrictEqual(["second"]);
	expect(handlerId).toBe(2);
});

test("useEventBus: unsubscribes on unmount", () => {
	const t = busUnderTest();
	const { unmount } = renderHook(() => {
		useEventBus(t.bus, "itemAdded", (payload) => t.added.push(payload));
	});
	unmount();

	act(() => {
		t.emitAdded("after");
	});
	expect(t.added).toStrictEqual([]);
});

test("useEventBus: resubscribes when the key changes", () => {
	const t = busUnderTest();
	const deliveries: Array<{ readonly key: string; readonly payload: unknown; }> = [];
	const { rerender } = renderHook(({ key }: { readonly key: keyof CartEvents & string; }) => {
		useEventBus(t.bus, key, (payload) => deliveries.push({ key, payload }));
	}, { initialProps: { key: "itemAdded" as keyof CartEvents & string } });

	act(() => {
		t.emitCleared(1);
	});
	expect(deliveries).toStrictEqual([]);

	rerender({ key: "cartCleared" });
	act(() => {
		t.emitCleared(1);
		t.emitAdded("b");
	});
	expect(deliveries).toStrictEqual([{ key: "cartCleared", payload: 1 }]);
});

test("useEventBus: does not replay events emitted before mount", () => {
	const t = busUnderTest();
	act(() => {
		t.emitAdded("early");
	});
	renderHook(() => {
		useEventBus(t.bus, "itemAdded", (payload) => t.added.push(payload));
	});
	expect(t.added).toStrictEqual([]);
});
