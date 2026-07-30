import type { ProgramConfig } from '@lib/programs/program-step';
import { AGENT_SKILL_STEPS } from '@lib/programs/agent-skill/index';
import { OutroKind } from '@lib/wizard-session';
import { getContentBlocks } from './content/index.js';

const FEATURE_FLAGS_REPORT_FILE = 'posthog-feature-flags-report.md';
const FEATURE_FLAGS_DOCS_URL = 'https://posthog.com/docs/feature-flags';
const SUCCESS_MESSAGE = 'Your feature flag is ready to test';

/**
 * No fixed `skillId`: context-mill publishes one feature-flag skill per
 * framework, so the agent selects and installs the matching variant at runtime.
 */
export const featureFlagsConfig: ProgramConfig = {
  command: 'feature-flags',
  description: 'Add a PostHog feature flag to an existing app',
  id: 'feature-flags',
  steps: AGENT_SKILL_STEPS,
  reportFile: FEATURE_FLAGS_REPORT_FILE,
  getContentBlocks,
  requires: ['posthog-integration'],
  run: {
    integrationLabel: 'feature-flags',
    customPrompt:
      () => `Add one real PostHog feature flag to this existing application.

This flow has no pre-installed skill:

1. Inspect the project's manifest and source tree to identify its framework and
   language.
2. Call \`load_skill_menu\` once with \`category: "feature-flags"\` and select
   the most specific matching framework skill. Prefer a framework-specific
   variant over a broad or omnibus skill.
3. Call \`install_skill\` with the selected skill ID.
4. Read the installed \`SKILL.md\` and its first workflow reference before
   planning or changing the application.

If no matching skill is available or \`install_skill\` fails, do not continue
without the knowledge source. Emit exactly:

[ABORT] A matching PostHog feature flag skill could not be installed.

After reading the workflow, your next message must contain ONLY parallel
\`TaskCreate\` calls: one call per workflow stage, all in the order defined by
the skill. The tool accepts one task per call. Do not call \`TaskUpdate\`, run
another tool, or start workflow work until every initial task exists.

Follow the installed skill in order. Its first step verifies the existing
PostHog SDK integration. Use the SDK dependency and configuration already in
the project; do not install, reinstall, or upgrade a PostHog SDK package. Never
open, read, or search value-bearing \`.env*\` files. Enumerate environment
filenames without their contents, then use \`check_env_keys\` to check only
whether the required configuration names are present.

The proposal is an interactive decision gate. Inspect the current working tree
and prefer a suitable developer-owned change. Before any PostHog write or
application source edit, call \`wizard_ask\` with the proposal required by the
skill and wait for the answer. Make this one batched call for the decision: let
the developer accept the recommendation, choose another inspected candidate
when available, or describe a different behavior in an optional text answer.
Never choose or implement a demonstration feature without confirmation.

If \`wizard_ask\` is unavailable, cancelled, or returns no confirmed behavior,
do not call a PostHog write tool or edit application source. Emit exactly:

[ABORT] Feature flag proposal confirmation is required.

The installed skill owns the feature-flag workflow, PostHog configuration,
application changes, verification, and secret-handling guidance. Write its
final report to ./${FEATURE_FLAGS_REPORT_FILE}.

End the report with a short "Try your flag" section that states the control
behavior, the flagged behavior, and any verification still blocked or not run.
Do not duplicate the detailed verification table.`,
    successMessage: SUCCESS_MESSAGE,
    reportFile: FEATURE_FLAGS_REPORT_FILE,
    docsUrl: FEATURE_FLAGS_DOCS_URL,
    spinnerMessage: 'Adding a PostHog feature flag...',
    estimatedDurationMinutes: 5,
    buildOutroData: (_session, credentials) => {
      const uiHost = credentials.host.appHost.replace(/\/$/, '');
      const featureFlagsUrl = `${uiHost}/project/${credentials.projectId}/feature_flags`;

      return {
        kind: OutroKind.Success as const,
        message: SUCCESS_MESSAGE,
        primaryLink: {
          label: 'Open Feature Flags',
          url: featureFlagsUrl,
        },
        nextSteps: {
          heading: 'Try your flag:',
          items: [
            'Exercise the control experience',
            'Enable the flag for your test person and exercise the flagged experience',
            'Confirm the live evaluation in PostHog, then restore the safe rollout',
          ],
        },
        reportFile: FEATURE_FLAGS_REPORT_FILE,
        docsUrl: FEATURE_FLAGS_DOCS_URL,
        handoffPrompt: `Read \`${FEATURE_FLAGS_REPORT_FILE}\` and help me complete any blocked or not-run checks in its verification table. Start with the control and flagged experiences, and get my approval before changing the flag rollout.`,
      };
    },
    abortCases: [
      {
        match: /a working PostHog SDK integration is required/i,
        message: 'PostHog SDK setup required',
        body: 'Run the standard PostHog Wizard first, then run `wizard feature-flags` again.',
        docsUrl: 'https://posthog.com/docs/getting-started/install',
      },
      {
        match: /a matching PostHog feature flag skill could not be installed/i,
        message: 'Feature flag skill unavailable',
        body: 'The Wizard could not find or install a feature flag skill that matches this app. Check your connection and try again.',
        docsUrl: FEATURE_FLAGS_DOCS_URL,
      },
      {
        match: /feature flag proposal confirmation is required/i,
        message: 'Feature flag proposal not confirmed',
        body: 'Run the command again and confirm which product change the Wizard should place behind the flag.',
        docsUrl: FEATURE_FLAGS_DOCS_URL,
      },
      {
        match: /PostHog feature flag access is required/i,
        message: 'PostHog feature flag access required',
        body: 'Reconnect PostHog MCP with feature flag access, or create the proposed flag in PostHog and run the command again.',
        docsUrl:
          'https://posthog.com/docs/feature-flags/creating-feature-flags',
      },
      {
        match: /selected feature flag skill does not match this application/i,
        message: 'Feature flag skill does not match this app',
        body: 'Run the command again so the agent can select the framework-specific feature flag skill.',
        docsUrl: FEATURE_FLAGS_DOCS_URL,
      },
    ],
  },
};
