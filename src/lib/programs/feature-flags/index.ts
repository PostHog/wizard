import type { ProgramConfig } from '@lib/programs/program-step';
import { AGENT_SKILL_STEPS } from '@lib/programs/agent-skill/index';
import { getContentBlocks } from './content/index.js';

const FEATURE_FLAGS_REPORT_FILE = 'posthog-feature-flags-report.md';

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
  allowedTools: ['Agent'],
  requires: ['posthog-integration'],
  run: {
    integrationLabel: 'feature-flags',
    customPrompt:
      () => `Add one real PostHog feature flag to this existing application.

This flow has no pre-installed skill:

1. Inspect the project's manifest and source tree to identify its framework and
   language.
2. Call \`load_skill_menu\` once with \`category: "feature-flags"\` and select
   the most specific matching framework skill. For Next.js, select
   \`feature-flags-nextjs\`; do not substitute the broad omnibus skill.
3. Call \`install_skill\` with the selected skill ID, then follow its
   \`SKILL.md\` and linked references end-to-end.

If no matching skill is available or \`install_skill\` fails, do not continue
without the knowledge source. Emit exactly:

[ABORT] A matching PostHog feature flag skill could not be installed.

The installed skill owns the feature-flag workflow, PostHog configuration,
application changes, verification, and secret-handling guidance. Write its
final report to ./${FEATURE_FLAGS_REPORT_FILE}.`,
    successMessage: `Feature flag added! View the report at ./${FEATURE_FLAGS_REPORT_FILE}`,
    reportFile: FEATURE_FLAGS_REPORT_FILE,
    docsUrl: 'https://posthog.com/docs/feature-flags',
    spinnerMessage: 'Adding a PostHog feature flag...',
    estimatedDurationMinutes: 5,
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
        docsUrl: 'https://posthog.com/docs/feature-flags',
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
        docsUrl: 'https://posthog.com/docs/feature-flags',
      },
    ],
  },
};
