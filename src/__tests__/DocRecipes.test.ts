// Behavioral checks for the compiled recipe fixtures (scripts/doc-fixtures/).
// These encode the deterministic scenarios the recipes promise: a cancelled
// document stops its in-flight validation, and a retried create-POST replays
// one idempotency key per logical submission.
import { EventBus } from "@pplnd/core";
import { expect, test, vi } from "vitest";
import * as eventsFixture from "../../scripts/doc-fixtures/events-and-state.ts";
import * as requestFixture from "../../scripts/doc-fixtures/request-lifecycle.ts";

test("events-and-state: cancelling the document aborts its in-flight validation", async () => {
	const { fetchStub, ingestBus, validation, actor } = eventsFixture;

	const published: string[] = [];
	const unsubscribe = EventBus.subscribe(ingestBus).tap((message) => {
		published.push(message.kind);
	});

	expect(fetchStub.pending).toBeDefined();
	expect(fetchStub.pending?.signal?.aborted).toBe(false);

	EventBus.emit(ingestBus, { kind: "cancelled", value: { documentId: "doc_1" } });

	await vi.waitFor(() => expect(fetchStub.pending?.signal?.aborted).toBe(true));
	await vi.waitFor(() => expect(validation.state.get("doc_1")?.kind).toBe("OpNil"));
	expect(actor.getState().kind).toBe("cancelled");
	await new Promise((resolve) => setTimeout(resolve, 20));
	// The cancelled message itself is on the bus; no validated/rejected outcome followed.
	expect(published).toStrictEqual(["cancelled"]);

	unsubscribe();
});

test("request-lifecycle: retries replay the same idempotency key for one submission", async () => {
	const { handleSubmit, server, ticketManager } = requestFixture;

	server.failNext = true;
	const errors = handleSubmit({ subject: "Printer on fire", priority: "high", assignee: "ops" });
	expect(errors).toStrictEqual([]);

	await vi.waitFor(() => expect(ticketManager.state.kind).toBe("OpOk"));

	expect(server.attempts).toBe(2);
	expect(server.keys).toHaveLength(2);
	expect(new Set(server.keys).size).toBe(1);
	expect(server.tickets.size).toBe(1);
});
