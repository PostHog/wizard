/**
 * The `pi` backend — the challenger. Drives pi.dev's coding agent
 * (`@earendil-works/pi-coding-agent`) against the PostHog LLM gateway, behind
 * `wizard-runner=pi`. It owns the agent loop and model transport; prompt
 * assembly, error routing, and the outro stay in `linear.ts`, shared with the
 * `anthropic` control.
 *
 * Transport: the gateway is registered as an `anthropic-messages` provider
 * (same protocol the claude-agent-sdk path uses), bearer auth, Bedrock-fallback
 * + wizard metadata/flag headers, model id matched to `anthropic` for a clean
 * A/B. Security parity (canUseTool + YARA) and skills/MCP discovery are
 * follow-ups (#525, #524 skills) — v1 uses pi's built-in coding tools.
 */

import { getUI } from '../../../../ui';
import { logToFile } from '../../../../utils/debug';
import { getLlmGatewayUrlFromHost } from '../../../../utils/urls';
import {
  POSTHOG_FLAG_HEADER_PREFIX,
  POSTHOG_PROPERTY_HEADER_PREFIX,
} from '../../../constants';
import { AgentErrorType } from '../../agent-interface';
import { getWizardCommandments } from '../../commandments';
import type { AgentBackend, AgentResult, BackendRunInputs } from './types';

/** Provider + model registered on the in-memory registry for this run. */
const GATEWAY_PROVIDER = 'posthog-gateway';
/** Bare model id (no `anthropic/` prefix) so the gateway's Bedrock fallback matches. */
const MODEL_ID = 'claude-sonnet-4-6';

/**
 * Gateway HTTP headers, mirroring `buildAgentEnv` on the anthropic path: always
 * the Bedrock-fallback header, plus wizard metadata (`X-POSTHOG-PROPERTY-*`) and
 * wizard feature flags (`X-POSTHOG-FLAG-*`).
 */
function buildGatewayHeaders(
  wizardMetadata: Record<string, string>,
  wizardFlags: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'x-posthog-use-bedrock-fallback': 'true',
  };
  for (const [key, value] of Object.entries(wizardMetadata)) {
    const name = key.startsWith(POSTHOG_PROPERTY_HEADER_PREFIX)
      ? key
      : `${POSTHOG_PROPERTY_HEADER_PREFIX}${key}`;
    headers[name] = value;
  }
  for (const [flagKey, variant] of Object.entries(wizardFlags)) {
    if (!flagKey.toLowerCase().startsWith('wizard')) continue;
    headers[POSTHOG_FLAG_HEADER_PREFIX + flagKey.toUpperCase()] = variant;
  }
  return headers;
}

export const piBackend: AgentBackend = {
  name: 'pi',

  async run(inputs: BackendRunInputs): Promise<AgentResult> {
    const { session, boot, prompt, spinner, config } = inputs;

    spinner.start(config.spinnerMessage ?? 'Customizing your PostHog setup...');

    try {
      const {
        createAgentSession,
        DefaultResourceLoader,
        SessionManager,
        AuthStorage,
        ModelRegistry,
        getAgentDir,
      } = await import('@earendil-works/pi-coding-agent');

      // Register the PostHog gateway as an anthropic-messages provider. Auth is
      // the posthog token as a bearer; headers carry Bedrock-fallback + wizard
      // metadata/flags — identical to the claude-agent-sdk path.
      const baseUrl = getLlmGatewayUrlFromHost(boot.host);
      const registry = ModelRegistry.inMemory(AuthStorage.create());
      registry.registerProvider(GATEWAY_PROVIDER, {
        name: 'PostHog Gateway',
        baseUrl,
        apiKey: boot.accessToken,
        authHeader: true,
        api: 'anthropic-messages',
        headers: buildGatewayHeaders(boot.wizardMetadata, boot.wizardFlags),
        models: [
          {
            id: MODEL_ID,
            name: 'Claude Sonnet 4.6 (PostHog Gateway)',
            api: 'anthropic-messages',
            reasoning: true,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200_000,
            maxTokens: 64_000,
          },
        ],
      });

      const model = registry.find(GATEWAY_PROVIDER, MODEL_ID);
      if (!model) {
        return {
          error: AgentErrorType.API_ERROR,
          message: 'pi: gateway model could not be resolved',
        };
      }
      logToFile(`[pi] gateway ${baseUrl} model ${MODEL_ID}`);

      // System prompt = wizard commandments. Skip project context files /
      // user extensions / skills so the run is hermetic; skills discovery is a
      // follow-up (#524).
      const resourceLoader = new DefaultResourceLoader({
        cwd: session.installDir,
        agentDir: getAgentDir(),
        systemPrompt: getWizardCommandments(),
        noExtensions: true,
        noSkills: true,
        noContextFiles: true,
        noPromptTemplates: true,
        noThemes: true,
      });
      await resourceLoader.reload();

      // Wizard capabilities as custom tools (pi has no MCP): skill
      // discovery/install + fenced .env edits, same names as the MCP server so
      // the shared prompt is unchanged. pi's built-in Read/Write/Edit/Bash do
      // the code changes. Loaded lazily — it pulls in typebox (ESM), which must
      // stay out of the static module graph so CommonJS unit tests can load the
      // backend seam without parsing it.
      const { createWizardPiTools } = await import('./pi-tools');
      const customTools = createWizardPiTools({
        workingDirectory: session.installDir,
        skillsBaseUrl: boot.skillsBaseUrl,
      });

      const { session: agentSession } = await createAgentSession({
        model,
        modelRegistry: registry,
        cwd: session.installDir,
        sessionManager: SessionManager.inMemory(session.installDir),
        resourceLoader,
        customTools,
      });

      // Map pi events onto the run spinner + the log file. Markers + todos are
      // a follow-up (the shared stream→TUI bridge); v1 keeps the spinner alive
      // and records tool I/O to the log.
      const unsubscribe = agentSession.subscribe((event) => {
        switch (event.type) {
          case 'tool_execution_start': {
            const args = JSON.stringify(event.args ?? {}).slice(0, 200);
            logToFile(`[pi] → ${event.toolName} ${args}`);
            spinner.message(`Running ${event.toolName}…`);
            break;
          }
          case 'tool_execution_end': {
            if (event.isError) {
              logToFile(
                `[pi] ✗ ${event.toolName}: ${String(event.result).slice(0, 300)}`,
              );
            }
            break;
          }
          case 'agent_end': {
            logToFile(`[pi] agent_end (willRetry=${event.willRetry})`);
            break;
          }
          default:
            break;
        }
      });

      try {
        // Non-streaming: resolves when the agent run completes. Throws if no
        // model/api key, or on a transport error.
        await agentSession.prompt(prompt);
      } finally {
        unsubscribe();
      }

      spinner.stop(config.successMessage ?? 'PostHog integration complete');
      return {};
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logToFile(`[pi] run error: ${message}`);
      spinner.stop(config.errorMessage ?? `${config.integrationLabel} failed`);
      getUI().log.error(`pi backend error: ${message}`);

      const lower = message.toLowerCase();
      if (lower.includes('rate limit') || lower.includes('429')) {
        return { error: AgentErrorType.RATE_LIMIT, message };
      }
      return { error: AgentErrorType.API_ERROR, message };
    }
  },
};
