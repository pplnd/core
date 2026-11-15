// Fixture for docs/src/content/docs/basics/quickstart.mdx.
// Fence-matched and compiled by `scripts/check-doc-fixtures.ts` — keep in sync with the page.
import { pipe, Result } from "@pplnd/core";

// --- block: the plain version ---
export const plainVersion = () => {
	// oxlint-disable-next-line no-shadow -- the plain version is block A's standalone rewrite
	type PriceError = { readonly kind: "NotANumber"; } | { readonly kind: "TooSmall"; readonly minimum: number; };

	const charge = (cents: number): string => `Charging ${(cents / 100).toFixed(2)}`;
	const report = (error: PriceError): string =>
		error.kind === "NotANumber" ? "That is not a number" : `Below the ${error.minimum}-cent minimum`;

	const parsePrice = (raw: string): PriceError | number => {
		const cents = Math.round(Number.parseFloat(raw) * 100);
		if (Number.isNaN(cents)) {
			return { kind: "NotANumber" };
		}
		if (cents < 100) {
			return { kind: "TooSmall", minimum: 100 };
		}
		return cents;
	};

	const price = parsePrice("12.90");

	if (typeof price === "number") {
		charge(price); // "Charging 12.90"
	} else {
		report(price); // "That is not a number" for "free"
	}
};

// --- block: the same function with Result ---
type PriceError = { readonly kind: "NotANumber"; } | { readonly kind: "TooSmall"; readonly minimum: number; };

const parsePrice = (raw: string): Result<PriceError, number> => {
	const cents = Math.round(Number.parseFloat(raw) * 100);
	if (Number.isNaN(cents)) {
		return Result.make.err({ kind: "NotANumber" });
	}
	if (cents < 100) {
		return Result.make.err({ kind: "TooSmall", minimum: 100 });
	}
	return Result.make.ok(cents);
};

// --- block: run it twice ---
const listed = parsePrice("12.90");
// Ok(1290)

const rejected = parsePrice("free");
// Err({ kind: "NotANumber" })

const decide = (result: Result<PriceError, number>): string => {
	if (Result.is.ok(result)) {
		return `Charge ${(result.value / 100).toFixed(2)}`;
	}
	if (result.error.kind === "NotANumber") {
		return "That is not a number";
	}
	return `Below the ${result.error.minimum}-cent minimum`;
};

decide(listed); // "Charge 12.90"
decide(rejected); // "That is not a number"

// --- block: a second step, twice over (map) ---
const withVat = (cents: number): number => Math.round(cents * 1.2);

const priced = Result.map(withVat)(listed);
// Ok(1548)

// --- block: a second step, twice over (chain) ---
type DiscountError = { readonly kind: "Expired"; readonly code: string; };

const applyDiscount = (code: string) => (cents: number): Result<DiscountError, number> =>
	code === "WELCOME" && cents >= 500 ? Result.make.ok(cents - 500) : Result.make.err({ kind: "Expired", code });

const discounted = Result.chain(applyDiscount("WELCOME"))(priced);
// Ok(1048)

const refused = Result.chain(applyDiscount("OLD2019"))(priced);
// Err({ kind: "Expired", code: "OLD2019" })

// --- block: the same flow as a pipeline ---
const checkout = (raw: string, code: string) =>
	pipe(parsePrice(raw), Result.map(withVat), Result.chain(applyDiscount(code)));

checkout("12.90", "WELCOME"); // Ok(1048)
checkout("12.90", "OLD2019"); // Err({ kind: "Expired", code: "OLD2019" })
checkout("free", "WELCOME"); // Err({ kind: "NotANumber" })

export { checkout, discounted, listed, priced, refused, rejected };
