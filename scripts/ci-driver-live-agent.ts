/**
 * Live proof: a REAL gateway LLM drives the wizard-ci-tools MCP server.
 *
 * Configures the PostHog LLM gateway with the phx personal API key as bearer
 * (the same "creative hack" the CI auth path uses — no OAuth, no browser),
 * attaches the in-process wizard-ci-tools server to a real `query()`, and asks
 * the model to read the wizard's state and advance it. Success = the model
 * actually moved the real store off the intro screen by calling perform_action.
 *
 *   PHX_KEY_FILE=/path/to/key.txt tsx scripts/ci-driver-live-agent.ts
 */

import fs from 'fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { WizardStore } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui/index';
import { buildSession } from '@lib/wizard-session';
import { buildAgentEnv } from '@lib/agent/agent-interface';
import { Program } from '@lib/programs/program-registry';
import { WizardCiDriver } from '@lib/ci-driver/wizard-ci-driver';
import {
  createWizardCiToolsServer,
  CI_TOOL_NAMES,
} from '@lib/ci-driver/wizard-ci-tools';

const GATEWAY_URL = 'https://gateway.us.posthog.com/wizard';
const MODEL = 'claude-haiku-4-5-20251001';

async function main() {
  const keyFile = process.env.PHX_KEY_FILE;
  if (!keyFile) throw new Error('Set PHX_KEY_FILE to the phx key path');
  const phxKey = fs.readFileSync(keyFile, 'utf8').trim();

  // Point the agent SDK at the PostHog gateway, phx key as bearer.
  process.env.ANTHROPIC_BASE_URL = GATEWAY_URL;
  process.env.ANTHROPIC_AUTH_TOKEN = phxKey;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = phxKey;
  process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = 'true';

  const store = new WizardStore(Program.PostHogIntegration);
  setUI(new InkUI(store));
  store.session = buildSession({ installDir: '/tmp/ci-live', ci: true });
  const driver = new WizardCiDriver(store);
  const server = await createWizardCiToolsServer(driver);

  process.stdout.write(
    `\nBefore: currentScreen=${
      driver.readState().currentScreen
    } setupConfirmed=${store.session.setupConfirmed}\n\n`,
  );

  const prompt =
    'You are driving a PostHog wizard through its test control plane. ' +
    'The wizard is on its intro screen. Your very first action must be to call ' +
    'the perform_action tool with {"action":"confirm_setup"} (no other params) ' +
    'to advance past it. Do that immediately, before anything else. ' +
    'Then call read_state once and report the new currentScreen. Be terse.';

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 220_000);

  const toolCalls: string[] = [];
  let finalText = '';

  // Streaming-input prompt. A plain string prompt closes stdin after turn 1,
  // which breaks every follow-up turn (the wizard hits the same SDK bug and
  // works around it the same way). Keep the generator open until the SDK
  // emits its `result` message so the session survives multi-turn tool use.
  let signalDone!: () => void;
  const resultReceived = new Promise<void>((r) => {
    signalDone = r;
  });
  const promptStream = async function* () {
    yield {
      type: 'user' as const,
      session_id: '',
      message: { role: 'user' as const, content: prompt },
      parent_tool_use_id: null,
    };
    await resultReceived;
  };

  try {
    const response = query({
      prompt: promptStream(),
      options: {
        abortController: abort,
        model: MODEL,
        permissionMode: 'bypassPermissions',
        betas: ['context-1m-2025-08-07'],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        tools: { type: 'preset', preset: 'claude_code' },
        env: {
          ...process.env,
          // The user's Anthropic key (set in this shell) would override the
          // gateway bearer and 401 — unset it so ANTHROPIC_AUTH_TOKEN wins.
          ANTHROPIC_API_KEY: undefined,
          ANTHROPIC_BASE_URL: GATEWAY_URL,
          ANTHROPIC_AUTH_TOKEN: phxKey,
          CLAUDE_CODE_OAUTH_TOKEN: phxKey,
          ENABLE_TOOL_SEARCH: 'auto:0',
          MCP_CONNECTION_NONBLOCKING: '0',
          // The gateway expects PostHog's custom headers (bedrock fallback +
          // metadata) — the wizard sets these for every real run.
          ANTHROPIC_CUSTOM_HEADERS: buildAgentEnv({}, {}),
        },
        mcpServers: { [`wizard-ci-tools`]: server },
        allowedTools: [
          CI_TOOL_NAMES.readState,
          CI_TOOL_NAMES.listActions,
          CI_TOOL_NAMES.performAction,
        ],
      },
    } as never);

    for await (const msg of response as AsyncIterable<any>) {
      if (msg.type === 'assistant') {
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'tool_use') {
            toolCalls.push(block.name);
            process.stdout.write(`  → tool_use: ${block.name}\n`);
          } else if (block.type === 'text' && block.text) {
            finalText = block.text;
          }
        }
      } else if (msg.type === 'result') {
        if (msg.result) finalText = msg.result;
        signalDone(); // close the prompt stream so the SDK can exit
      }
      // Stop as soon as the model has driven the store off the intro screen —
      // one successful tool-driven commit is the proof we're after.
      if (store.session.setupConfirmed) {
        abort.abort();
        break;
      }
    }
  } catch (e) {
    // A later-turn gateway error must not mask a commit that already landed —
    // we evaluate store state below regardless.
    process.stdout.write(
      `  (query ended: ${e instanceof Error ? e.message.split('\n')[0] : e})\n`,
    );
  } finally {
    signalDone();
    clearTimeout(timer);
  }

  const after = driver.readState();
  process.stdout.write(
    `\nAfter: currentScreen=${after.currentScreen} setupConfirmed=${store.session.setupConfirmed}\n`,
  );
  process.stdout.write(`Model said: ${finalText.slice(0, 200)}\n`);
  process.stdout.write(`Tool calls: ${toolCalls.join(', ') || '(none)'}\n\n`);

  const advanced = store.session.setupConfirmed === true;
  process.stdout.write(
    `${
      advanced
        ? '✓ LLM advanced the real store via wizard-ci-tools'
        : '✗ store did not advance'
    }\n\n`,
  );
  process.exit(advanced ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`\nLIVE_FAIL: ${e?.stack ?? e}\n`);
  process.exit(1);
});
