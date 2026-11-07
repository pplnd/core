import { struct } from "#composition";
import { test } from "vitest";
import { assertEquivalent } from "../../__bench__/equivalence.ts";

type Row = { id: number; name: string; score: number; active: boolean; };

const rows = Array.from(
	{ length: 256 },
	(_, i) => ({ id: i, name: `row-${i}`, score: (i * 37) % 100, active: i % 3 === 0 }),
);

const fields: Record<PropertyKey, (value: Row) => unknown> = {
	label: (row) => `${row.id}:${row.name}`,
	score: (row) => row.score,
	active: (row) => row.active,
};

const current = struct(fields);

// Previous implementation: enumerates the field keys on every call.
const previous = (row: Row) => {
	const result: Record<PropertyKey, unknown> = {};
	for (const key of Reflect.ownKeys(fields)) {
		result[key] = fields[key](row);
	}
	return result;
};

let cursor = 0;
const nextRow = () => {
	cursor = (cursor + 1) & 255;
	return rows[cursor];
};

test("struct-fields", async ({ bench }) => {
	assertEquivalent("struct-fields", current(rows[0]), previous(rows[0]));
	await bench.compare(
		bench("1. (current) keys hoisted to construction", () => current(nextRow())),
		bench("2. Reflect.ownKeys per call (previous)", () => previous(nextRow())),
	);
});
