import { Duration } from "../Types/Duration.ts";

/**
 * Normalizes a retry policy's optional budget to milliseconds: `undefined` when absent,
 * clamped to zero when negative.
 */
export const normalizeBudgetMs = (policy: { readonly budget?: Duration; }): number | undefined =>
	policy.budget === undefined ? undefined : Math.max(0, Duration.to.milliseconds(policy.budget));

/**
 * Whether scheduling one more attempt after `nextDelayMs` would push the retry sequence past
 * its budget, measured from `startedAt`. A missing budget never exhausts.
 */
export const isBudgetExhausted = (startedAt: number, nextDelayMs: number, budgetMs: number | undefined): boolean =>
	budgetMs !== undefined && Date.now() - startedAt + nextDelayMs > budgetMs;
