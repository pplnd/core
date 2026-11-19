import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { expect, test } from "vitest";

test("environment: StrictMode render pipeline is wired", () => {
	render(
		<StrictMode>
			<p>pipelined react</p>
		</StrictMode>,
	);
	expect(screen.getByText("pipelined react")).toBeDefined();
});
