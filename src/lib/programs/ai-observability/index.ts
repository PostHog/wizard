import type { ProgramConfig, ProgramStep } from '@lib/programs/program-step';
import { AGENT_SKILL_STEPS } from '@lib/programs/agent-skill/index';
import { getContentBlocks } from '@lib/programs/agent-skill/content/index';

const AI_OBSERVABILITY_STEPS: ProgramStep[] = AGENT_SKILL_STEPS.map((step) =>
  step.id === 'intro' ? { ...step, screenId: 'ai-observability-intro' } : step,
);

const AI_OBSERVABILITY_REPORT_FILE = 'posthog-ai-observability-report.md';

/**
 * `wizard ai-observability` — wrap the project's LLM client calls so they emit
 * `$ai_generation` events into LLM Analytics.
 *
 * No `run.skillId`: the context-mill `ai-observability` group ships one variant
 * per (LLM provider × language) and the wizard does no provider detection —
 * the agent loads the menu, matches the manifest's vendor SDK, and installs
 * the right variant itself (see `customPrompt`). Stays flat while a single
 * "add AIO to a project" flow is the only action.
 */
export const aiObservabilityConfig: ProgramConfig = {
  command: 'ai-observability',
  description: 'Add PostHog AI Observability to your LLM calls',
  id: 'ai-observability',
  steps: AI_OBSERVABILITY_STEPS,
  reportFile: AI_OBSERVABILITY_REPORT_FILE,
  getContentBlocks,
  run: {
    integrationLabel: 'ai-observability',
    // No `skillId`: linear.ts skips its pre-install step (see the gate on
    // `linear.ts:47`), so the agent must load the menu and install the right
    // variant itself. The prompt below tells it how.
    customPrompt:
      () => `Instrument this project's LLM calls with PostHog AI Observability.

This flow has no pre-installed skill — you install the right one yourself:

1. Call \`load_skill_menu\` with \`category: "ai-observability"\`. The menu is
   the source of truth: one variant per (LLM provider × language), plus a
   \`manual-capture\` variant for projects with no vendor SDK.

2. Scan the project manifest (\`package.json\`, \`pyproject.toml\`,
   \`requirements.txt\`) for a vendor LLM SDK and pick the variant that matches
   it — the language follows the manifest (\`package.json\` → Node, Python
   tooling → Python). Multiple SDKs (e.g. LangChain wrapping OpenAI) → prefer
   the higher abstraction. No vendor SDK → the \`manual-capture\` variant.
   Genuinely ambiguous → \`wizard_ask\` with a multi-choice picker.

3. Call \`install_skill\` with the picked variant id. Then follow that skill's
   \`SKILL.md\` and references end-to-end. The skill itself will install
   packages, wire OTel, set env vars, and describe verification.

Make only additive changes — do not touch existing PostHog init, identify
calls, event capture, or dashboards. Those belong to other skills. The
final report is written to ./${AI_OBSERVABILITY_REPORT_FILE}.`,
    successMessage: `AI Observability configured! View the report at ./${AI_OBSERVABILITY_REPORT_FILE}`,
    reportFile: AI_OBSERVABILITY_REPORT_FILE,
    docsUrl: 'https://posthog.com/docs/ai-observability',
    spinnerMessage: 'Setting up AI Observability...',
    estimatedDurationMinutes: 5,
  },
};
