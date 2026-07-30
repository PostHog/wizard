import type { ProgramConfig, ProgramStep } from '@lib/programs/program-step';
import type { AbortCase } from '@lib/agent/agent-runner';
import { AGENT_SKILL_STEPS } from '@lib/programs/agent-skill/index';
import { getContentBlocks } from '@lib/programs/logs/content/index';

const LOGS_STEPS: ProgramStep[] = AGENT_SKILL_STEPS.map((step) =>
  step.id === 'intro' ? { ...step, screenId: 'logs-intro' } : step,
);

const LOGS_REPORT_FILE = 'posthog-logs-report.md';

/**
 * Project-level truth for whether session replay is on, read from
 * `/api/projects/:id/` at auth time.
 *
 * The skill needs this to decide whether the `session` correlation tier is
 * reachable at all, and repo-local evidence can't answer it — replay is
 * routinely enabled from the snippet or from a separate frontend repo, so its
 * absence here proves nothing. `null`/`undefined` means the opt-in wasn't in
 * the payload, which is not the same as "off".
 */
function sessionReplayNote(enabled: boolean | null | undefined): string {
  if (enabled === true) {
    return 'Session replay is enabled on this PostHog project, so linking log records to recordings is achievable — aim for the `session` correlation tier.';
  }
  if (enabled === false) {
    return 'Session replay is disabled on this PostHog project, so log records cannot link to recordings however they are wired. Aim for the `person` tier and say in the report that enabling session replay is what would unlock replay linking.';
  }
  return 'This run could not read whether session replay is enabled on this PostHog project. Wire correlation as normal and let the verify step establish which tier was actually reached, rather than assuming either way.';
}

/**
 * `[ABORT] <reason>` cases the `logs-setup` skill can emit. The reason string is
 * part of the skill contract — it is defined in the skill's `Abort statuses`
 * section (context-mill `context/skills/logs-setup`).
 */
const LOGS_ABORT_CASES: AbortCase[] = [
  {
    // Skill emits: [ABORT] No supported runtime found
    match: /^no supported runtime found$/i,
    message: 'No supported runtime found',
    body:
      'The wizard automates PostHog Logs for Next.js and Python, and neither ' +
      'appears in this directory. PostHog Logs supports many more runtimes ' +
      'than the wizard automates today — JavaScript, Node, Go, Java, Ruby, ' +
      'iOS, Android, React Native, Flutter, and a Datadog forwarder. See ' +
      'https://posthog.com/docs/logs/installation to set one up by hand, or ' +
      'run this from the directory that holds your Next.js or Python app.',
  },
];

/**
 * `wizard logs` — send this project's logs to PostHog and correlate each record
 * to the person and session replay that produced it.
 *
 * Installation is the table-stakes half and the docs already cover it. The half
 * that needs an agent is correlation: `posthogDistinctId` and `sessionId` have
 * to be reachable from wherever a log line is emitted, and where that identity
 * lives differs in every codebase — an auth middleware here, a request context
 * there. The `logs-setup` skill chain does that work.
 *
 * No `run.skillId`: the context-mill `logs-setup` group ships one variant per
 * runtime and the wizard does no runtime detection — the agent loads the menu,
 * matches the project manifest, and installs the right variant itself (see
 * `customPrompt`). Stays flat while "set up logs for this project" is the only
 * action; a family form would be premature.
 */
export const logsConfig: ProgramConfig = {
  command: 'logs',
  description: 'Set up PostHog Logs and link them to sessions and people',
  id: 'logs',
  steps: LOGS_STEPS,
  reportFile: LOGS_REPORT_FILE,
  getContentBlocks,
  run: {
    integrationLabel: 'logs',
    // No `skillId`: linear.ts skips its pre-install step when one isn't set, so
    // the agent loads the menu and installs the variant that matches the
    // project. The prompt below tells it how.
    customPrompt: (ctx) => `Set up PostHog Logs for this project.

${sessionReplayNote(ctx.teamProductOptIns?.sessionReplay)}

This flow has no pre-installed skill — you install the right one yourself:

1. Call \`load_skill_menu\` with \`category: "logs-setup"\`. The menu is the
   source of truth: one variant per runtime.

2. Read the project manifest to pick the variant. \`package.json\` with a
   \`next\` dependency → the Next.js variant. \`pyproject.toml\`,
   \`requirements.txt\`, or \`setup.py\` → the Python variant.

   A repo containing both — a Next.js frontend and a Python backend — is
   common. Server-emitted logs are where correlation is missing, so pick the
   variant matching the runtime that emits them, and use \`wizard_ask\` when it
   is genuinely ambiguous which that is.

3. Call \`install_skill\` with the picked variant id. Then follow that skill's
   \`SKILL.md\` and its numbered references end-to-end, one step at a time.

Make only additive changes. Existing logging must keep working exactly as it
does today — do not swap out a logging library, change log levels, or rewrite
log messages. Do not touch existing PostHog init, identify calls, or event
capture beyond the one \`tracing_headers\` option the skill asks for.

The final report is written to ./${LOGS_REPORT_FILE}.`,
    successMessage: `PostHog Logs configured! View the report at ./${LOGS_REPORT_FILE}`,
    reportFile: LOGS_REPORT_FILE,
    docsUrl: 'https://posthog.com/docs/logs',
    spinnerMessage: 'Setting up PostHog Logs...',
    estimatedDurationMinutes: 12,
    abortCases: LOGS_ABORT_CASES,
  },
};
