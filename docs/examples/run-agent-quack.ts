/* eslint-disable no-console -- the example prints to the terminal */
// Run only the agent with runAgent, against a local PostHog stack.
//
//   npx tsx --tsconfig tsconfig.json docs/examples/run-agent-quack.ts
//
// Needs local PostHog on :8010 (with its ai-gateway) and context-mill on :8765.
// POSTHOG_PERSONAL_API_KEY logs in. WIZARD_CI_GATEWAY_TOKEN_FILE holds the gateway token.
// QUACK_INSTALL_DIR sets the project the agent runs in (default: the current directory).
import {
  configureGatewayFromCIEnvironment,
  runAgent,
  RunOutcome,
} from '@agent';
import type { RunConfig, RunInput } from '@agent/types';
import {
  Harness,
  HAIKU_MODEL,
  Sequence,
  getSkillsBaseUrl,
} from '@shared/constants';
import { initLocalDev, POSTHOG_LOCAL_URL } from '@shared/local-dev';
import { getOrAskForProjectData } from '@utils/setup-utils';

// Point PostHog, skills and MCP at the local stack, like --local-posthog --local-context-mill --local-mcp.
initLocalDev({ localPosthog: true, localContextMill: true, localMcp: true });

// Log in with keys instead of the browser, the same way --ci does.
const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
if (!apiKey) throw new Error('Set POSTHOG_PERSONAL_API_KEY');
const programId = 'posthog-integration'; // a program the local gateway admits
const login = await getOrAskForProjectData({
  signup: false,
  ci: true, // with apiKey, this skips OAuth
  apiKey,
  baseUrl: POSTHOG_LOCAL_URL,
  localMcp: true,
  programId,
});
// Use the token in WIZARD_CI_GATEWAY_TOKEN_FILE at WIZARD_CI_GATEWAY_URL instead of minting one.
configureGatewayFromCIEnvironment(login.projectId, 'us');

// What the agent runs: one prompt, a small model, no Write, Edit or Bash.
const config: RunConfig = {
  programId, // pins the gateway spend
  run: {
    integrationLabel: 'quack',
    prompt: () => 'Reply with the single word quack. Use no tools.',
    collectTranscript: true, // keep the agent's output for snapshot.transcriptTail
    requestRemark: false, // no closing remark
    spinnerMessage: 'Quacking...',
    successMessage: 'Quacked',
    estimatedDurationMinutes: 1,
    reportFile: '',
    docsUrl: 'https://posthog.com/docs',
  },
  composed: true, // a sub-run: no terminal outro
  // runAgent doesn't resolve a route. Linear on the Anthropic harness keeps the transcript.
  binding: {
    sequence: Sequence.linear,
    harness: Harness.anthropic,
    model: HAIKU_MODEL,
  },
  switchboard: { program: programId, composed: true, flags: {} },
  skillsBaseUrl: getSkillsBaseUrl(),
  wizardFlags: {},
  wizardFlagPayloads: {},
  wizardMetadata: {},
  disallowedTools: ['Write', 'Edit', 'Bash'],
};

// Where and as whom: the project, the login and the flags.
const input: RunInput = {
  installDir: process.env.QUACK_INSTALL_DIR ?? process.cwd(),
  credentials: {
    accessToken: login.accessToken,
    refreshToken: login.refreshToken,
    expiresAt: login.expiresAt,
    projectApiKey: login.projectApiKey,
    host: login.host,
    projectId: login.projectId,
    missingScopes: login.missingScopes,
  },
  project: login.project,
  apiUser: login.user,
  flags: {
    ci: false,
    signup: false,
    debug: false,
    e2eAsk: false,
    localMcp: true,
    captureAio: false,
    benchmark: false,
    yaraReport: false,
  },
  host: { baseUrl: POSTHOG_LOCAL_URL },
};

// Run it. Each step the agent takes arrives as one activity line.
const result = await runAgent(config, input, {
  onProgress: (event) => {
    if (event.kind === 'activity') console.log(`activity: ${event.line}`);
  },
});

// Every ending resolves to a result. Print the reply and the outcome.
console.log(`transcriptTail: ${result.snapshot.transcriptTail ?? ''}`);
console.log(`outcome: ${result.outcome}`);
if (result.outcome !== RunOutcome.Success)
  console.log(`failure: ${result.failure.message}`);
process.exit(result.outcome === RunOutcome.Success ? 0 : 1);
