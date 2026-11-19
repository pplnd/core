import { Duration, Op } from "@pplnd/core";
import { expectTypeOf, test } from "vitest";
import { useOpPoll, type UseOpPollOptions } from "../useOpPoll.ts";

declare const manager: Op.Manager<[string], string, number, Op.State<string, number>>;
declare const options: UseOpPollOptions;

test("useOpPoll: accepts a manager, an interval, and the manager's args", () => {
	expectTypeOf(useOpPoll(manager, options, "u_1")).toEqualTypeOf<void>();
	expectTypeOf(useOpPoll(manager, { every: Duration.seconds(30) }, "u_1")).toEqualTypeOf<void>();
});

test("useOpPoll: options are all-optional except the interval", () => {
	expectTypeOf<UseOpPollOptions>().toEqualTypeOf<{ readonly every: Duration; }>();
});

test("useOpPoll: rejects args that do not match the manager's Args tuple", () => {
	expectTypeOf(useOpPoll(manager, options, "u_1")).toEqualTypeOf<void>();
	// @ts-expect-error the manager's Args is [string]; a number arg is rejected
	useOpPoll(manager, options, 42);
	// @ts-expect-error the required args tuple cannot be omitted
	useOpPoll(manager, options);
});
