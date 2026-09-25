/* eslint-disable no-console -- the example prints to the terminal */
// Run one program with runProgram, against a local PostHog stack.
//
//   npx tsx --tsconfig tsconfig.json docs/examples/run-program-quack.ts
//
// Needs local PostHog on :8010 (with its ai-gateway) and context-mill on :8765.
// QUACK_INSTALL_DIR sets the project the agent runs in (default: the current directory).
import { RunOutcome } from '@agent';
import { runProgram } from '@programs';
import type { ProgramProgress } from '@programs/types';
import { Harness, HAIKU_MODEL, Sequence } from '@shared/constants';
import { initLocalDev, POSTHOG_LOCAL_URL } from '@shared/local-dev';
import { getOrAskForProjectData } from '@utils/setup-utils';

// Point PostHog, skills and MCP at the local stack, like --local-posthog --local-context-mill --local-mcp.
initLocalDev({ localPosthog: true, localContextMill: true, localMcp: true });

// Log in with the wizard's own browser OAuth flow. The token stays in memory.
const programId = 'posthog-integration'; // a program the local gateway admits
const login = await getOrAskForProjectData({
  signup: false,
  ci: false,
  baseUrl: POSTHOG_LOCAL_URL,
  localMcp: true,
  programId,
});

// Log status lines as the program reports them. runProgram never waits for this.
function logProgress(progress: ProgramProgress): void {
  if (progress.kind === 'program') return; // a data snapshot; it holds tokens, don't log it
  const { event } = progress;
  if (event.kind === 'status') console.log(`status: ${event.message}`);
  if (event.kind === 'lifecycle') console.log(`lifecycle: ${event.phase}`);
}

const result = await runProgram(
  programId,
  {
    installDir: process.env.QUACK_INSTALL_DIR ?? process.cwd(),
    // A caller-built run in place of the program's own: one prompt, and keep the reply.
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
    program: { disallowedTools: ['Write', 'Edit', 'Bash'] },
    // The login from above, so runProgram skips its own login step.
    credentials: {
      posthog: {
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
    },
    composed: true, // a sub-run: no terminal outro
    // A small model on the linear Anthropic route, where the transcript is kept.
    overrides: {
      sequence: Sequence.linear,
      harness: Harness.anthropic,
      model: HAIKU_MODEL,
    },
    flags: { localMcp: true },
    host: { baseUrl: POSTHOG_LOCAL_URL },
    wizardFlags: {}, // no flag snapshot to load
  },
  {
    // You approved AI data processing for this local test user.
    awaitAiApproval: () => Promise.resolve(true),
    onProgress: logProgress,
  },
);

// Endings resolve to an outcome. The agent's reply is in its settled run's transcript.
const reply = result.settledRuns[0]?.result.snapshot.transcriptTail ?? '';
console.log(`reply: ${reply}`);
console.log(`outcome: ${result.outcome}`);
if (result.failure) console.log(`failure: ${result.failure.message}`);
process.exit(result.outcome === RunOutcome.Success ? 0 : 1);
