import type { ProgramConfig } from '@lib/programs/program-step';
import { AGENT_SKILL_STEPS } from '@lib/programs/agent-skill/index';
import { getContentBlocks } from '@lib/programs/agent-skill/content/index';

const FEATURE_FLAGS_REPORT_FILE = 'posthog-feature-flags-report.md';

/**
 * `wizard feature-flags` — add PostHog feature flag code to the project.
 *
 * No `run.skillId`: the context-mill `feature-flags` group ships one variant
 * per language/framework (React, Next.js, Django, Rails, Go, ...) with no
 * example apps to detect against, so the wizard does no framework matching —
 * the agent loads the menu, matches the manifest, and installs the right
 * variant itself (see `customPrompt`). Mirrors `ai-observability`.
 */
export const featureFlagsConfig: ProgramConfig = {
  command: 'feature-flags',
  description: 'Add PostHog feature flags to your project',
  id: 'feature-flags',
  steps: AGENT_SKILL_STEPS,
  reportFile: FEATURE_FLAGS_REPORT_FILE,
  getContentBlocks,
  run: {
    integrationLabel: 'feature-flags',
    // No `skillId`: linear.ts skips its pre-install step (see the gate on
    // `linear.ts:47`), so the agent must load the menu and install the right
    // variant itself. The prompt below tells it how.
    customPrompt: () => `Add PostHog feature flags to this project.

This flow has no pre-installed skill — you install the right one yourself:

1. Call \`load_skill_menu\` with \`category: "feature-flags"\`. The menu is
   the source of truth: one variant per language/framework.

2. Scan the project manifest (\`package.json\`, \`pyproject.toml\`,
   \`requirements.txt\`, \`Gemfile\`, \`go.mod\`, ...) for the project's
   language/framework and pick the variant that matches it. Genuinely
   ambiguous → \`wizard_ask\` with a multi-choice picker.

3. Call \`install_skill\` with the picked variant id. Then follow that
   skill's \`SKILL.md\` and references end-to-end. Wire up a real feature
   flag around a small, meaningful piece of existing functionality so the
   user can see it working — don't just install the SDK. If PostHog is not
   integrated yet, install and initialize it first as the skill instructs —
   do not abort.

Make only additive changes — do not touch existing PostHog init, identify
calls, event capture, or dashboards. Those belong to other skills. The
final report is written to ./${FEATURE_FLAGS_REPORT_FILE}.`,
    successMessage: `Feature flags configured! View the report at ./${FEATURE_FLAGS_REPORT_FILE}`,
    reportFile: FEATURE_FLAGS_REPORT_FILE,
    docsUrl: 'https://posthog.com/docs/feature-flags',
    spinnerMessage: 'Setting up feature flags...',
    estimatedDurationMinutes: 5,
  },
};
