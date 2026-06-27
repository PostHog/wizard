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

import fs from 'fs';
import path from 'path';
import { getUI } from '@ui';
import { getLogFilePath, logToFile } from '@utils/debug';
import { getLlmGatewayUrlFromHost } from '@utils/urls';
import {
  POSTHOG_FLAG_HEADER_PREFIX,
  POSTHOG_PROPERTY_HEADER_PREFIX,
} from '../../../constants';
import { AgentErrorType } from '../../agent-interface';
import { getWizardCommandments } from '../../commandments';
import type { AgentResult, AgentRunner, BackendRunInputs } from './types';

/** Provider registered on the in-memory registry for this run. */
const GATEWAY_PROVIDER = 'posthog-gateway';

/**
 * The gateway speaks two shapes on two endpoints: Anthropic models over
 * `anthropic-messages` (the SDK appends `/v1/messages`, so the base URL has no
 * `/v1`), and OpenAI-class models (`openai/gpt-5`, …) over OpenAI completions at
 * `/v1/chat/completions` (base URL keeps `/v1`). Infer the shape from the model
 * id so a pair's model selects the right transport.
 */
function gatewayApiFor(
  modelId: string,
): 'anthropic-messages' | 'openai-completions' {
  return modelId.startsWith('openai/')
    ? 'openai-completions'
    : 'anthropic-messages';
}

/**
 * pi-specific runtime guidance appended to the shared commandments. Targets the
 * top run-slowness causes (profiled): the agent reaching for blocked `bash
 * ls/find` to explore (each retry is a model round-trip), re-fetching the skill
 * menu, and writing literal PostHog URLs that the YARA scanner blocks at write
 * time. Steering it once up front avoids the retry spirals.
 */
const PI_RUNTIME_NOTES = [
  '',
  '## This runtime',
  "- To see a directory's files, call the `read` tool with the directory path (e.g. read '.' or read 'src/'); it returns the listing. Use `read` for files too. NEVER run `ls`, `find`, `cat`, or `grep` through `bash` — they are blocked and waste a turn.",
  '- `bash` is ONLY for install/build/typecheck/lint/format. Run installs SYNCHRONOUSLY (e.g. `npm install <pkg>`); do not background with `&`, chain with `&&`, or pipe — all are blocked.',
  '- Call `load_skill_menu` once to choose the skill, then `install_skill`. Do not call `load_skill_menu` again this session.',
  "- Never write a PostHog URL or token as a literal in source (e.g. 'https://us.i.posthog.com') — it is blocked. Read them from environment variables (process.env.POSTHOG_HOST, os.environ['POSTHOG_HOST'], etc.).",
  '- Update the task list FREQUENTLY as you work — mark items `completed` the moment you finish them and `in_progress` as you pick them up, so the displayed step always reflects where you actually are. Keep titles broad and action-oriented (the area of work), not specific files or sub-steps.',
].join('\n');

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

/** Pull plain text out of a pi AgentMessage (content is text/image blocks). */
function extractText(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: string; text: string } => {
        const block = c as { type?: string; text?: unknown };
        return block?.type === 'text' && typeof block.text === 'string';
      })
      .map((c) => c.text)
      .join('');
  }
  return '';
}

export const piBackend: AgentRunner = {
  name: 'pi',

  async run(inputs: BackendRunInputs): Promise<AgentResult> {
    const { session, boot, prompt, spinner, config, programConfig } = inputs;
    const modelId = inputs.model;

    // Init banner (parity #5).
    getUI().log.step('Initializing Wizard agent...');
    getUI().log.step(`Verbose logs: ${getLogFilePath()}`);
    getUI().log.success("Agent initialized. Let's get cooking!");

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

      // Register the PostHog gateway. Auth is the posthog token as a bearer;
      // headers carry Bedrock-fallback + wizard metadata/flags — identical to
      // the claude-agent-sdk path. The transport shape is inferred from the
      // model id; OpenAI completions is served at `/v1/...`, so it keeps the
      // `/v1` the Anthropic SDK strips.
      const api = gatewayApiFor(modelId);
      const gatewayUrl = getLlmGatewayUrlFromHost(boot.host);
      const baseUrl =
        api === 'openai-completions' ? `${gatewayUrl}/v1` : gatewayUrl;
      const registry = ModelRegistry.inMemory(AuthStorage.create());
      registry.registerProvider(GATEWAY_PROVIDER, {
        name: 'PostHog Gateway',
        baseUrl,
        apiKey: boot.accessToken,
        authHeader: true,
        api,
        headers: buildGatewayHeaders(boot.wizardMetadata, boot.wizardFlags),
        models: [
          {
            id: modelId,
            name: `${modelId} (PostHog Gateway)`,
            api,
            reasoning: true,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200_000,
            maxTokens: 64_000,
          },
        ],
      });

      const model = registry.find(GATEWAY_PROVIDER, modelId);
      if (!model) {
        return {
          error: AgentErrorType.API_ERROR,
          message: 'pi: gateway model could not be resolved',
        };
      }
      logToFile(`[pi] gateway ${baseUrl} model ${modelId} (${api})`);

      // System prompt = wizard commandments. Skip project context files /
      // user extensions / skills so the run is hermetic; skills discovery is a
      // follow-up (#524).
      //
      // Fail-closed security (#525): an extension intercepts EVERY tool call —
      // built-in and custom — and reuses the anthropic policy (canUseTool
      // allowlist + .env fencing + YARA). `noExtensions: true` only suppresses
      // disk-discovered extensions; explicit `extensionFactories` still load,
      // so the fence is on while the target project can't inject its own.
      const { createSecurityExtension } = await import('./pi-security');
      const security = createSecurityExtension({
        disallowedTools: programConfig.disallowedTools,
      });

      const resourceLoader = new DefaultResourceLoader({
        cwd: session.installDir,
        agentDir: getAgentDir(),
        systemPrompt: getWizardCommandments() + '\n' + PI_RUNTIME_NOTES,
        noExtensions: true,
        noSkills: true,
        noContextFiles: true,
        noPromptTemplates: true,
        noThemes: true,
        extensionFactories: [security.factory],
      });
      await resourceLoader.reload();

      // Wizard capabilities as custom tools (pi has no MCP): skill
      // discovery/install + fenced .env edits, same names as the MCP server so
      // the shared prompt is unchanged. pi's built-in Read/Write/Edit/Bash do
      // the code changes. Loaded lazily — it pulls in typebox (ESM), which must
      // stay out of the static module graph so CommonJS unit tests can load the
      // backend seam without parsing it.
      const { createWizardPiTools } = await import('./pi-tools');
      const { createWizardPiTaskTools } = await import('./pi-tasks');
      const { createDispatchAgentTool } = await import('./pi-subagent');
      const customTools = [
        ...createWizardPiTools({
          workingDirectory: session.installDir,
          skillsBaseUrl: boot.skillsBaseUrl,
        }),
        // Task/todo tools (#526): render the todo list live in the TUI, parity
        // with the anthropic path.
        ...createWizardPiTaskTools().tools,
        // Controlled subagent dispatch (#526): a nested fenced session with a
        // read-only toolset and no dispatch_agent of its own, so it can't
        // escape the fence or recurse.
        createDispatchAgentTool({
          model,
          modelRegistry: registry,
          cwd: session.installDir,
          agentDir: getAgentDir(),
          securityFactory: security.factory as (pi: unknown) => void,
          sdk: { createAgentSession, DefaultResourceLoader, SessionManager },
        }),
      ];

      const { session: agentSession } = await createAgentSession({
        model,
        modelRegistry: registry,
        cwd: session.installDir,
        sessionManager: SessionManager.inMemory(session.installDir),
        resourceLoader,
        customTools,
      });

      // Map pi events onto the run spinner + the log file, mirroring the
      // anthropic path's log shape (assistant turns + tool I/O) and driving the
      // single run spinner with one stable status at a time (no overlap).
      const unsubscribe = agentSession.subscribe((event) => {
        switch (event.type) {
          case 'message_end': {
            const assistant = extractText(event.message).trim();
            if (assistant) {
              logToFile(`[pi] assistant: ${assistant.slice(0, 1000)}`);
            }
            break;
          }
          case 'tool_execution_start': {
            const args = JSON.stringify(event.args ?? {}).slice(0, 200);
            logToFile(`[pi] → ${event.toolName} ${args}`);
            // Don't surface raw tool names in the spinner — the anthropic path
            // doesn't, and it reads as noise. The Task panel (syncTodos) is the
            // visible progress, matching the anthropic presentation.
            break;
          }
          case 'tool_execution_end': {
            if (event.isError) {
              logToFile(
                `[pi] ✗ ${event.toolName}: ${String(event.result).slice(
                  0,
                  300,
                )}`,
              );
            }
            break;
          }
          case 'agent_end': {
            logToFile(`[pi] agent_end (willRetry=${String(event.willRetry)})`);
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

      // A latched post-scan violation terminates the run as a YARA violation,
      // matching the anthropic path's AgentErrorType.YARA_VIOLATION.
      if (security.state.criticalViolation) {
        spinner.stop('Security violation detected');
        logToFile(
          `[pi] terminated: YARA violation (blocked ${security.state.blockedCount} call(s))`,
        );
        return { error: AgentErrorType.YARA_VIOLATION };
      }

      // The skill plans events into .posthog-events.json then asks to remove it
      // on completion; pi's `rm` is fence-blocked, so the agent can't — clean it
      // up host-side rather than leave a stale (often empty) artifact (#15).
      try {
        const planFile = path.join(session.installDir, '.posthog-events.json');
        if (fs.existsSync(planFile)) await fs.promises.rm(planFile);
      } catch (err) {
        logToFile(`[pi] .posthog-events.json cleanup skipped: ${String(err)}`);
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
