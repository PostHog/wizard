/* eslint-disable no-console -- the example prints to the terminal */
// Run one program with runProgram, against a local PostHog stack.
//
//   npx tsx --tsconfig tsconfig.json docs/examples/run-program-quack.ts
//
// Needs local PostHog on :8010 (with its ai-gateway) and context-mill on :8765.
// POSTHOG_PERSONAL_API_KEY logs in. WIZARD_CI_GATEWAY_TOKEN_FILE holds the gateway token.
// QUACK_INSTALL_DIR sets the project the agent runs in (default: the current directory).
import {
  buildSession,
  resolveApiKeyLogin,
  RunOutcome,
  runProgram,
  SessionStore,
} from '@programs';
import type { ProgramProgress } from '@programs/types';
import { Harness, HAIKU_MODEL, Sequence } from '@shared/constants';
import { readCiGatewayCredential } from '@shared/ci-gateway';
import { initLocalDev, POSTHOG_LOCAL_URL } from '@shared/local-dev';

// Point PostHog, skills and MCP at the local stack, like --local-posthog --local-context-mill --local-mcp.
initLocalDev({ localPosthog: true, localContextMill: true, localMcp: true });

// Log in with keys instead of the browser, the same way --ci does.
const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
if (!apiKey) throw new Error('Set POSTHOG_PERSONAL_API_KEY');
const programId = 'posthog-integration'; // a program the local gateway admits
const login = await resolveApiKeyLogin(apiKey, {
  baseUrl: POSTHOG_LOCAL_URL,
  localMcp: true,
  onWarning: (message) => console.warn(message),
});
// Use the token in WIZARD_CI_GATEWAY_TOKEN_FILE at WIZARD_CI_GATEWAY_URL instead of minting one.
login.posthog.gateway = readCiGatewayCredential('us');

// Log status lines as the program reports them. runProgram never waits for this.
function logProgress(progress: ProgramProgress): void {
  const { event } = progress;
  if (event.kind === 'status') console.log(`status: ${event.message}`);
  if (event.kind === 'lifecycle') console.log(`lifecycle: ${event.phase}`);
}

// You own the session store: runProgram reads the launch values from it and writes the run into it.
const store = new SessionStore(
  buildSession({
    installDir: process.env.QUACK_INSTALL_DIR ?? process.cwd(),
    baseUrl: POSTHOG_LOCAL_URL,
    localMcp: true,
    // A small model on the linear Anthropic route, where the transcript is kept.
    sequence: Sequence.linear,
    harness: Harness.anthropic,
    model: HAIKU_MODEL,
  }),
);
// The quack prompt reads nothing from the project, so skip the program's detection.
store.setDetectionComplete();

const result = await runProgram(
  programId,
  {
    store,
    // Laid over the program's own config: one prompt, keep the reply, no health check.
    config: {
      run: {
        integrationLabel: 'quack',
        prompt: () => 'Reply with the single word quack. Use no tools.',
        collectTranscript: true, // keep the agent's output for the reply below
        requestRemark: false, // no closing remark
        spinnerMessage: 'Quacking...',
        successMessage: 'Quacked',
        estimatedDurationMinutes: 1,
        reportFile: '',
        docsUrl: 'https://posthog.com/docs',
      },
      disallowedTools: ['Write', 'Edit', 'Bash'],
      healthCheck: false,
    },
    credentials: login, // the login from above, so runProgram skips its own login step
    composed: true, // a sub-run: no terminal outro
    wizardFlags: {}, // no flag snapshot to load
  },
  {
    // You approved AI data processing for this local test user.
    workflow: {
      confirmStep: (step) =>
        Promise.resolve(step.kind === 'ai-approval' || step.kind === 'run'),
    },
    onProgress: logProgress,
  },
);

// Endings resolve to an outcome. The agent's reply is in its run's transcript.
const reply = result.runResults[0]?.snapshot.transcriptTail ?? '';
console.log(`reply: ${reply}`);
console.log(`outcome: ${result.outcome}`);
if (result.failure) console.log(`failure: ${result.failure.message}`);
process.exit(result.outcome === RunOutcome.Success ? 0 : 1);
