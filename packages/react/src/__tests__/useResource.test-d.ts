import { RemoteData, Resource, Task } from "@pplnd/core";
import { expectTypeOf, test } from "vitest";
import { useResource, type UseResourceResult } from "../useResource.ts";

declare const resource: Resource<"lock taken", string>;
declare const result: UseResourceResult<"lock taken", string>;

test("useResource: binds the resource's error and value channels", () => {
	expectTypeOf(useResource(resource)).toEqualTypeOf<UseResourceResult<"lock taken", string>>();
	expectTypeOf(result.state).toEqualTypeOf<RemoteData<"lock taken", string>>();
});

test("useResource: rejects non-resource inputs", () => {
	const notAResource: { readonly kind: null; } = { kind: null };
	expectTypeOf(result.state).toEqualTypeOf<RemoteData<"lock taken", string>>();
	// @ts-expect-error an object without the resource's brand and acquisition surface is rejected
	useResource(notAResource);
});
