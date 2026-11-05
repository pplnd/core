import { constTruthyBool } from "#test-utils";
import { expectTypeOf, test } from "vitest";
import { Duration } from "../../Types/Duration.ts";
import { RetryPolicy } from "../../Types/RetryPolicy.ts";
import type { Deferred } from "../Deferred.ts";
import { type Result } from "../Result.ts";
import { Supervisor } from "../Supervisor.ts";
import { Task } from "../Task.ts";

test("run: settles with the task error or the stopped lifetime", () => {
	const task: Task.Result<"offline", void> = constTruthyBool()
		? Task.Result.make.ok(undefined)
		: Task.Result.make.err("offline");
	const supervisor = Supervisor.make(task, {
		restart: RetryPolicy.constant({ attempts: 2, delay: Duration.seconds(1) }),
	});

	expectTypeOf(supervisor.run()).toEqualTypeOf<Deferred<Result<"offline", Supervisor.Stopped>>>();
	expectTypeOf(supervisor.state()).toEqualTypeOf<Supervisor.State<"offline">>();
	expectTypeOf(supervisor.abort).toEqualTypeOf<() => void>();
	expectTypeOf(supervisor.subscribe).toEqualTypeOf<
		(listener: (state: Supervisor.State<"offline">) => void) => () => void
	>();
});

test("State: narrows on kind and carries the failure payload", () => {
	const task: Task.Result<"offline", void> = constTruthyBool()
		? Task.Result.make.ok(undefined)
		: Task.Result.make.err("offline");
	const supervisor = Supervisor.make(task, {
		restart: RetryPolicy.constant({ attempts: 2, delay: Duration.seconds(1) }),
	});
	const state = supervisor.state();
	if (state.kind === "SupervisorFailed") {
		expectTypeOf(state.error).toEqualTypeOf<"offline">();
		expectTypeOf(state.attempts).toEqualTypeOf<number>();
	}
	expectTypeOf<Supervisor.Stopped["reason"]>().toEqualTypeOf<"aborted" | "completed">();
});

test("make: negative — a supervisor requires a restart policy", () => {
	expectTypeOf(
		// @ts-expect-error a supervisor needs a restart policy
		Supervisor.make(Task.Result.make.ok(undefined)),
	).toBeObject();
});
