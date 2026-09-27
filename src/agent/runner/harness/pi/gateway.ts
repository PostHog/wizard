/**
 * PostHog AI gateway provider spec for pi sessions, shared by the linear run
 * and the orchestrator's per-task runs so both speak to the gateway
 * identically: bearer auth, the wizard properties header, transport shape
 * inferred from the model id. The caller registers the spec on its own
 * (lazily imported, properly typed) pi ModelRegistry.
 */

import {
  buildWizardPropertiesBlob,
  isPastRefresh,
  type GatewayAuth,
} from '@agent/gateway-session';
import {
  modelCapabilities,
  type ThinkingLevel,
} from '../../switchboard/models';
import { AgentErrorType } from '@agent/signals';

/** Provider registered on the in-memory registry for this run. */
export const GATEWAY_PROVIDER = 'posthog-gateway';

/** The pi transports the gateway serves. */
export type GatewayApi =
  | 'anthropic-messages'
  | 'openai-completions'
  | 'openai-responses';

/**
 * The gateway speaks two shapes on two endpoints: Anthropic models over
 * `anthropic-messages` (the SDK appends `/v1/messages`, so the base URL has no
 * `/v1`), and OpenAI-class models (`openai/gpt-5`, …) over an OpenAI shape at
 * `/v1/responses` or `/v1/chat/completions` (base URL keeps `/v1`). Infer the
 * shape from the model id so a pair's model selects the right transport.
 *
 * OpenAI models take the Responses API because OpenAI rejects function tools
 * combined with `reasoning_effort` on chat completions and every task sends both.
 */
export function gatewayApiFor(modelId: string): GatewayApi {
  return modelId.startsWith('openai/')
    ? 'openai-responses'
    : 'anthropic-messages';
}

/**
 * Gateway HTTP headers, mirroring `buildAgentEnv` on the anthropic path: one
 * `X-PostHog-Properties` JSON blob (Bedrock fallback is native, so no opt-in)
 * plus the 1M context beta, since pi otherwise runs at 200k and overflows on
 * larger projects (the post-run compaction failures).
 */
export function buildGatewayHeaders(
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
  teamId?: number,
): Record<string, string> {
  return {
    'anthropic-beta': 'context-1m-2025-08-07',
    'X-PostHog-Properties': buildWizardPropertiesBlob(
      wizardMetadata,
      wizardFlags,
      teamId,
    ),
  };
}

export interface GatewayProviderInputs {
  gatewayUrl: string;
  accessToken: string;
  /** Customer team for the properties blob (from the mint response). */
  teamId?: number;
  wizardMetadata: Record<string, string>;
  wizardFlags: Record<string, string>;
  modelId: string;
  // Resolved effort override — the switchboard's flag/payload pick on linear
  // runs, the prompt-frontmatter effort on per-task agents. Overrides the
  // table default for a reasoning model when set.
  effort?: ThinkingLevel;
}

/**
 * One gateway model spec — the single description of how to reach a model on
 * the gateway. The provider spec below wraps it for pi's registry; one-shot
 * callers (scan triage) hand it straight to `completeSimple`.
 */
export function buildGatewayModel(inputs: GatewayProviderInputs) {
  const { gatewayUrl, wizardMetadata, wizardFlags, modelId, teamId } = inputs;
  const api = gatewayApiFor(modelId);
  return {
    id: modelId,
    name: `${modelId} (PostHog Gateway)`,
    api,
    provider: GATEWAY_PROVIDER,
    // Anthropic drops /v1 (the SDK appends /v1/messages); the OpenAI shape keeps it.
    baseUrl: api === 'anthropic-messages' ? gatewayUrl : `${gatewayUrl}/v1`,
    // A model trait resolved by the switchboard, not a harness guess:
    // non-reasoning openai models reject `reasoning_effort` (gpt-4o → gateway
    // UnsupportedParamsError → the run no-ops).
    reasoning: modelCapabilities(modelId).reasoning,
    input: ['text' as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    headers: buildGatewayHeaders(wizardMetadata, wizardFlags, teamId),
  };
}

/**
 * The provider object for `registry.registerProvider(GATEWAY_PROVIDER, …)`,
 * plus the derived traits the session setup needs (`caps.thinkingLevel`).
 */
export function buildGatewayProvider(inputs: GatewayProviderInputs): {
  provider: Record<string, unknown>;
  api: GatewayApi;
  caps: ReturnType<typeof modelCapabilities>;
  gatewayUrl: string;
  baseUrl: string;
} {
  const { gatewayUrl, accessToken, modelId, effort } = inputs;
  const api = gatewayApiFor(modelId);
  // One resolution point for the model's traits and the run's effort override.
  // pi clamps whatever comes out of here against the levels this spec declares,
  // so a level the spec doesn't carry is silently reduced by the session.
  const tableCaps = modelCapabilities(modelId);
  const caps =
    effort && effort !== 'off' && tableCaps.reasoning
      ? modelCapabilities(modelId, effort)
      : effort === 'off' && tableCaps.reasoning
      ? { ...tableCaps, thinkingLevel: 'off' as const }
      : tableCaps;

  const model = buildGatewayModel(inputs);
  const provider = {
    name: 'PostHog Gateway',
    baseUrl: model.baseUrl,
    apiKey: accessToken,
    authHeader: true,
    api,
    headers: model.headers,
    models: [model],
  };
  return { provider, api, caps, gatewayUrl, baseUrl: model.baseUrl };
}

/** The part of a pi assistant turn that says why it failed. */
export interface GatewayTurnError {
  errorMessage?: string;
  diagnostics?: { error?: { name?: string; code?: string | number } }[];
}

export type GatewayTerminalFailure = {
  classification:
    | AgentErrorType.API_ERROR
    | AgentErrorType.RATE_LIMIT
    | AgentErrorType.ABORT;
  message: string;
  status?: number;
};

/** Whether a turn failed because the model stream dropped mid-response. */
function isDroppedModelStream(turn: GatewayTurnError): boolean {
  return /upstream closed the stream|upstream connection lost|ECONNRESET|socket hang up|\bterminated\b/i.test(
    turn.errorMessage ?? '',
  );
}

/** What a user reads when the model stream dropped and pi's retries didn't recover it. */
function droppedStreamMessage(errorMessage: string): string {
  return (
    `The connection to the PostHog AI gateway dropped mid-response, and retrying didn't fix it (${errorMessage}). ` +
    'This is usually a network problem or a brief gateway issue. Try again in a few minutes.'
  );
}

export function gatewayTerminalFailure(
  turn: ({ stopReason?: string } & GatewayTurnError) | undefined,
): GatewayTerminalFailure | undefined {
  if (!turn || (turn.stopReason !== 'error' && turn.stopReason !== 'aborted'))
    return undefined;
  const message =
    turn.errorMessage ||
    (turn.stopReason === 'aborted'
      ? 'Agent turn aborted'
      : 'Gateway request failed');
  if (turn.stopReason === 'aborted') {
    return { classification: AgentErrorType.ABORT, message };
  }
  if (isDroppedModelStream(turn)) {
    return {
      classification: AgentErrorType.API_ERROR,
      message: droppedStreamMessage(message),
    };
  }
  const codes =
    turn.diagnostics
      ?.map((d) => d.error?.code)
      .filter((code) => code !== undefined) ?? [];
  const structuredStatus = codes
    .map(Number)
    .find((code) => Number.isInteger(code) && code >= 400 && code < 600);
  const rateLimited =
    structuredStatus !== undefined
      ? structuredStatus === 429
      : /\b429\b|rate limit/i.test(message);
  return {
    classification: rateLimited
      ? AgentErrorType.RATE_LIMIT
      : AgentErrorType.API_ERROR,
    message,
    status:
      structuredStatus ?? (isGatewayAuthRejection(turn) ? 401 : undefined),
  };
}

/**
 * Whether a turn's error is the gateway rejecting the bearer. pi attaches the
 * SDK's own error to `diagnostics`, so its code decides when one is present.
 * The message match is the fallback for a turn that failed before pi built a
 * diagnostic, where the status survives only as prose.
 */
export function isGatewayAuthRejection(
  turn: GatewayTurnError | string | undefined,
): boolean {
  const { errorMessage, diagnostics } =
    typeof turn === 'string'
      ? { errorMessage: turn, diagnostics: undefined }
      : turn ?? {};
  const structuredStatus = (diagnostics ?? [])
    .map((diagnostic) => Number(diagnostic.error?.code))
    .find((code) => Number.isInteger(code) && code >= 400 && code < 600);
  if (structuredStatus !== undefined) return structuredStatus === 401;
  for (const diagnostic of diagnostics ?? []) {
    const code = diagnostic.error?.code;
    if (code === 401 || code === '401') return true;
    if (/^authentication_?error$/i.test(diagnostic.error?.name ?? ''))
      return true;
  }
  return /\b401\b|authentication_error|unauthorized/i.test(errorMessage ?? '');
}

export interface GatewayRemintOptions {
  signal?: AbortSignal;
  session: { prompt(text: string): Promise<void> };
  registry: { registerProvider(providerName: string, config: never): void };
  auth: GatewayAuth;
  /** The cache: the same token while fresh, a new mint past the refresh point. */
  refreshAuth: () => Promise<GatewayAuth>;
  providerInputs: (auth: GatewayAuth) => GatewayProviderInputs;
  /** The prompt that resumes the work after a re-mint. */
  continueText: string | (() => string);
  onRemint?: () => void;
}

/**
 * Wraps a pi session's prompt(): when a turn ends on a 401 from a bearer past
 * its refresh instant, mint once, re-register the provider with the new
 * bearer (pi resolves the apiKey per request), and continue. A 401 on a fresh
 * bearer, or a second one, is left to the harness's normal failure path.
 */
export function withGatewayRemint(opts: GatewayRemintOptions): {
  prompt(text: string): Promise<void>;
  /** Feed every assistant `message_end`; the last turn decides. */
  noteAssistantTurn(message: unknown): void;
  terminalFailure(): GatewayTerminalFailure | undefined;
} {
  let auth = opts.auth;
  let rejected = false;
  let reminted = false;
  let lastTurn: ({ stopReason?: string } & GatewayTurnError) | undefined;
  return {
    noteAssistantTurn(message) {
      lastTurn = message as
        | ({ stopReason?: string } & GatewayTurnError)
        | undefined;
      rejected =
        lastTurn?.stopReason === 'error' && isGatewayAuthRejection(lastTurn);
    },
    terminalFailure: () => gatewayTerminalFailure(lastTurn),
    async prompt(text) {
      if (opts.signal?.aborted) return;
      rejected = false;
      lastTurn = undefined;
      await opts.session.prompt(text);
      if (opts.signal?.aborted || !rejected || reminted || !isPastRefresh(auth))
        return;
      reminted = true;
      auth = await opts.refreshAuth();
      if (opts.signal?.aborted) return;
      opts.registry.registerProvider(
        GATEWAY_PROVIDER,
        buildGatewayProvider(opts.providerInputs(auth)).provider as never,
      );
      opts.onRemint?.();
      rejected = false;
      lastTurn = undefined;
      const next = opts.continueText;
      if (opts.signal?.aborted) return;
      await opts.session.prompt(typeof next === 'function' ? next() : next);
    },
  };
}
