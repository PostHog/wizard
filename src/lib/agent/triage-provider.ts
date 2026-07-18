/**
 * LLM provider for warlock security-scan triage.
 *
 * Warlock's triageMatches() takes a consumer-supplied `(prompt) => Promise<string>`
 * to run a second pass that filters false positives out of YARA matches. This
 * builds that provider on top of the wizard's existing PostHog LLM gateway auth
 * — the same ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN that initializeAgent()
 * sets for the agent SDK. The gateway speaks the standard Anthropic Messages API,
 * so we POST to it directly with axios (the plain @anthropic-ai/sdk isn't a dep).
 */

import axios from 'axios';
import { logToFile } from '@utils/debug';
import type { LLMProvider } from '@posthog/warlock';

// Haiku 4.5: triage is a fast, narrow "true_positive | false_positive" verdict
// on already-flagged matches — Haiku's the right tier (cheap, fast, plenty
// capable for boolean classification). Do NOT swap to Sonnet without reason;
// the cost/latency difference matters on every flagged scan. temperature 0
// keeps verdicts deterministic across identical inputs.
const TRIAGE_MODEL = 'claude-haiku-4-5';
const TRIAGE_MAX_TOKENS = 16_384;
// Shorter than the hook timeout so a hung triage fails *inside* the hook's
// try/catch (→ fail-closed) rather than tripping the SDK hook timeout.
const TRIAGE_TIMEOUT_MS = 20_000;

interface AnthropicTextBlock {
  type: string;
  text?: string;
}

export interface TriageGatewayAuth {
  baseURL: string;
  authToken: string;
}

/**
 * Build the triage LLM provider. Auth comes from the explicit `auth` param
 * when given (the pi harness passes it from ToolGateContext.triageAuth, the
 * anthropic harness passes it from AgentRunConfig.triageAuth). Returns
 * undefined if auth is absent — callers then skip triage and fail closed
 * (act on every flagged match), so a missing key never silently disables the
 * scanner.
 *
 * The triage model is independent of the agent's model: it is a classifier
 * judging scan matches, and the gateway routes it by model id regardless of
 * which model runs the coding agent.
 */
export function createTriageLLMProvider(
  auth?: TriageGatewayAuth,
): LLMProvider | undefined {
  const baseURL = auth?.baseURL;
  const authToken = auth?.authToken;

  if (!baseURL || !authToken) {
    logToFile(
      '[YARA] triage provider unavailable (no gateway auth) — flagged scans will fail closed',
    );
    return undefined;
  }

  logToFile(`[YARA] triage provider ready (model: ${TRIAGE_MODEL})`);

  return async (prompt: string): Promise<string> => {
    const res = await axios.post(
      `${baseURL}/v1/messages`,
      {
        model: TRIAGE_MODEL,
        max_tokens: TRIAGE_MAX_TOKENS,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: TRIAGE_TIMEOUT_MS,
      },
    );

    const data = res.data as { content?: AnthropicTextBlock[] } | undefined;
    const content = data?.content;
    if (Array.isArray(content)) {
      return content
        .filter(
          (b: AnthropicTextBlock) =>
            b?.type === 'text' && typeof b.text === 'string',
        )
        .map((b: AnthropicTextBlock) => b.text)
        .join('');
    }
    return '';
  };
}
