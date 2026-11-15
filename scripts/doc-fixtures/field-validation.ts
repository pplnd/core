// Fixture for docs/src/content/docs/recipes/field-validation.md.
// Fence-matched and compiled by `scripts/check-doc-fixtures.ts` — keep in sync with the recipe.
import { Maybe, Num, pipe, Predicate, Validation } from "@pplnd/core";

// --- block: give every rule its own error id ---
type ErrorId = "REQUIRED_INPUT" | "TOO_LARGE" | "NOT_A_NUMBER" | "OUT_OF_RANGE" | "INVALID_EMAIL";

const isBlank = (text: string): boolean => text.trim().length === 0;
const isEmail = (text: string): boolean => /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(text);

const rule = <A>(predicate: Predicate<A>, errorId: ErrorId) => (value: A): Validation<ErrorId, A> =>
	Validation.from.Predicate(predicate, () => errorId)(value);

// --- block: two independent rules on one field ---
const required = rule(Predicate.not(isBlank), "REQUIRED_INPUT");
const atMost = (limit: number) => rule((text: string) => text.length <= limit, "TOO_LARGE");
const emailShape = rule(isEmail, "INVALID_EMAIL");

const validateAssetTag = (raw: string): Validation<ErrorId, string> =>
	pipe(Validation.struct({ required: required(raw), size: atMost(24)(raw) }), Validation.map(() => raw.trim()));

// --- block: parse first, then range-check ---
const validateDays = (raw: string): Validation<ErrorId, number> => {
	const parsed = Num.from.string(raw);
	if (Maybe.is.none(parsed)) {
		return Validation.make.failed("NOT_A_NUMBER");
	}
	return rule((value: number) => value >= 1 && value <= 30, "OUT_OF_RANGE")(parsed.value);
};

const validateEmail = (raw: string): Validation<ErrorId, string> =>
	pipe(
		Validation.struct({ required: required(raw), shape: emailShape(raw) }),
		Validation.map(() => raw.trim().toLowerCase()),
	);

// --- block: validate the whole form in one pass ---
type FormValues = { readonly assetTag: string; readonly days: string; readonly email: string; };

const validateRequest = Validation.keyed.make({ assetTag: validateAssetTag, days: validateDays, email: validateEmail });

type Checks = ReturnType<typeof validateRequest>;

// --- block: keep visibility on the state ---
type FormState = { readonly values: FormValues; readonly checks: Checks; readonly shown: boolean; };

type FormEvent =
	| { readonly kind: "edit"; readonly values: FormValues; }
	| { readonly kind: "blur"; readonly values: FormValues; }
	| { readonly kind: "submit"; readonly values: FormValues; }
	| { readonly kind: "dismiss"; };

const init = (values: FormValues): FormState => ({ values, checks: validateRequest(values), shown: false });

const update = (state: FormState, event: FormEvent): FormState => {
	if (event.kind === "dismiss") {
		return { ...state, shown: false };
	}
	const reveal = event.kind === "blur" || event.kind === "submit";
	return { values: event.values, checks: validateRequest(event.values), shown: state.shown || reveal };
};

// --- block: read what the screen needs ---
const fields = ["assetTag", "days", "email"] as const;
type Field = (typeof fields)[number];

const isShown = (state: FormState): boolean => state.shown;

const isInvalid = (state: FormState): boolean => Validation.keyed.is.failed(state.checks);

const invalidFields = (state: FormState): readonly Field[] =>
	fields.filter((field) => state.checks[field].kind === "Failed");

const errorsFor = (state: FormState, field: Field): readonly ErrorId[] => {
	if (!state.shown) {
		return [];
	}
	return pipe(
		Validation.keyed.getErrors(state.checks),
		Maybe.match({ some: (errors) => errors[field] ?? [], none: () => [] }),
	);
};

// --- block: the submit handler ---
declare function sendRentalRequest(
	values: { readonly assetTag: string; readonly days: number; readonly email: string; },
): void;

export const submit = (state: FormState): FormState => {
	const next = update(state, { kind: "submit", values: state.values });
	if (!isInvalid(next)) {
		const payload = Maybe.getOrElse(() => null)(Validation.keyed.getPassed(next.checks));
		if (payload !== null) {
			sendRentalRequest(payload);
		}
	}
	return next;
};

// --- block: the call order ---
let state = init({ assetTag: "", days: "", email: "" });
errorsFor(state, "assetTag"); // [] — validated, not shown

state = update(state, { kind: "submit", values: state.values });
isShown(state); // true
isInvalid(state); // true
invalidFields(state); // ["assetTag", "days", "email"]
errorsFor(state, "assetTag"); // ["REQUIRED_INPUT"]
errorsFor(state, "email"); // ["REQUIRED_INPUT", "INVALID_EMAIL"]

state = update(state, { kind: "edit", values: { ...state.values, assetTag: "EQ-118" } });
errorsFor(state, "assetTag"); // [] — the fixed field clears while the others stay
