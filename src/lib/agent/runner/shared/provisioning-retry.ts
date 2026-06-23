/**
 * Retry helper for transient provisioning/billing failures from the LLM
 * gateway's Bedrock fallback.
 *
 * The wizard forces `x-posthog-use-bedrock-fallback: true`, so a failed
 * Anthropic call is re-routed to AWS Bedrock. Bedrock can answer with a 403
 * `INVALID_PAYMENT_INSTRUMENT` / AWS Marketplace subscription error — a
 * PostHog-side billing condition that clears on its own and whose own message
 * advises retrying after ~2 minutes. Rather than aborting the run with the
 * terminal "report this" message, we wait and retry a couple of times.
 */

import { AgentErrorType } from '../../signals';

export type AgentRunResult = { error?: AgentErrorType; message?: string };

/**
 * Backoff schedule (ms) for retrying after a transient provisioning 403. The
 * upstream error advises retrying after ~2 minutes, so we wait roughly that
 * long, twice, before giving up.
 */
export const PROVISIONING_RETRY_DELAYS_MS = [120_000, 120_000];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `runOnce`; if it returns a `PROVISIONING_ERROR`, wait per the backoff
 * schedule and retry. Returns the last result — which may still be a
 * provisioning error if every attempt failed, leaving the caller to surface a
 * friendly transient-error message.
 *
 * `onRetry` runs before each wait so the caller can tell the user what's
 * happening; `delays`/`wait` are injectable so tests don't actually sleep.
 */
export async function runWithProvisioningRetry(
  runOnce: () => Promise<AgentRunResult>,
  onRetry: (info: { attempt: number; total: number; delayMs: number }) => void,
  opts: { delays?: number[]; wait?: (ms: number) => Promise<void> } = {},
): Promise<AgentRunResult> {
  const delays = opts.delays ?? PROVISIONING_RETRY_DELAYS_MS;
  const wait = opts.wait ?? sleep;

  let result = await runOnce();
  for (
    let attempt = 0;
    result.error === AgentErrorType.PROVISIONING_ERROR &&
    attempt < delays.length;
    attempt++
  ) {
    const delayMs = delays[attempt];
    onRetry({ attempt: attempt + 1, total: delays.length, delayMs });
    await wait(delayMs);
    result = await runOnce();
  }
  return result;
}
