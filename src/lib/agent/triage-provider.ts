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

const TRIAGE_MAX_TOKENS = 16_384;
// Shorter than the hook timeout so a hung triage fails inside the hook's
// try/catch (→ fail-closed) rather than tripping the SDK hook timeout.
const TRIAGE_TIMEOUT_MS = 20_000;

export interface TriageGatewayAuth {
  baseURL: string;
  authToken: string;
  wizardMetadata?: Record<string, string>;
  wizardFlags?: Record<string, string>;
}

/** Triage provider for a harness, or undefined when there's no gateway auth — callers then fail closed. */
export function createTriageLLMProvider(
  auth: TriageGatewayAuth | undefined,
  harness: Harness,
): LLMProvider | undefined {
  const baseURL = auth?.baseURL ?? process.env.ANTHROPIC_BASE_URL;
  const authToken = auth?.authToken ?? process.env.ANTHROPIC_AUTH_TOKEN;

  if (!baseURL || !authToken) {
    logToFile(
      '[YARA] triage provider unavailable (no gateway auth) — flagged scans will fail closed',
    );
    return undefined;
  }

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
