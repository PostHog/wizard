/**
 * LLM provider for warlock security-scan triage — the `(prompt) => Promise<string>`
 * its triageMatches() uses to filter false positives out of YARA matches. Runs
 * through the pi SDK on the same gateway model spec the harnesses use, so
 * transport, reasoning effort and trace headers come from one place.
 */

import { Harness } from '@lib/constants';
import { logToFile } from '@utils/debug';
import { buildGatewayModel } from '@lib/agent/runner/harness/pi/gateway';
import {
  modelCapabilities,
  triageModelFor,
} from '@lib/agent/runner/switchboard/models';
import type { LLMProvider } from '@posthog/warlock';

/**
 * `call_type` tag stamped on triage generations at the gateway, so scan spend
 * is separable from the agent work inside the same `program_id`. Callers pass
 * it on `wizardMetadata`; without it triage silently merges into the program's
 * agent cost and can't be measured on its own.
 */
export const TRIAGE_CALL_TYPE = 'yara-triage';

const TRIAGE_MAX_TOKENS = 16_384;
// Shorter than the hook timeout so a hung triage fails inside the hook's
// try/catch (→ fail-closed) rather than tripping the SDK hook timeout.
const TRIAGE_TIMEOUT_MS = 20_000;

export interface TriageGatewayAuth {
  /** Gateway base url — `credentials.host.gatewayUrl`. */
  baseURL: string;
  /** The run's OAuth access token. */
  authToken: string;
  wizardMetadata?: Record<string, string>;
  wizardFlags?: Record<string, string>;
}

/**
 * Triage provider for a harness. Auth is always explicit: every caller already
 * holds the gateway url and the run's token, and reading them back out of
 * ANTHROPIC_* made an unauthed provider silent — it returned undefined, the
 * caller failed closed, and a clean first-party skill got deleted.
 */
export function createTriageLLMProvider(
  auth: TriageGatewayAuth,
  harness: Harness,
): LLMProvider {
  const { baseURL, authToken } = auth;
  const modelId = triageModelFor(harness);
  const model = buildGatewayModel({
    gatewayUrl: baseURL,
    accessToken: authToken,
    wizardMetadata: auth?.wizardMetadata ?? {},
    wizardFlags: auth?.wizardFlags ?? {},
    modelId,
  });
  const { reasoning, thinkingLevel } = modelCapabilities(modelId);
  logToFile(
    `[YARA] triage provider ready (model: ${modelId}, api: ${model.api})`,
  );

  return async (prompt: string): Promise<string> => {
    // Lazy: pi-ai is a 5MB ESM tree, and this module is in the static graph of
    // every command. Same constraint as the pi harness's SDK imports.
    const { completeSimple } = await import('@earendil-works/pi-ai');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRIAGE_TIMEOUT_MS);
    try {
      const message = await completeSimple(
        model,
        {
          messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
        },
        {
          apiKey: authToken,
          // Determinism where the model allows it: the gpt-5 line rejects any
          // temperature but 1 while reasoning, and 400s the whole call.
          temperature: model.api === 'anthropic-messages' ? 0 : undefined,
          maxTokens: TRIAGE_MAX_TOKENS,
          // Luna needs an effort it recognises; a non-reasoning model rejects the param.
          reasoning:
            reasoning && thinkingLevel !== 'off' ? thinkingLevel : undefined,
          signal: controller.signal,
        },
      );
      const text = message.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('');
      // A failed call returns no text, which warlock fail-safes to
      // true_positive — indistinguishable from a real verdict unless logged.
      if (message.stopReason === 'error') {
        logToFile(
          `[YARA] triage call failed on ${model.id}: ${
            message.errorMessage ?? 'unknown'
          } — every flagged match will be acted on`,
        );
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  };
}
