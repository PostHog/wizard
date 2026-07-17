import type { ProgramConfig } from '@lib/programs/program-step';
import { AGENT_SKILL_STEPS } from '@lib/programs/agent-skill/index';
import { getContentBlocks } from '@lib/programs/agent-skill/content/index';

const AI_OBSERVABILITY_REPORT_FILE = 'posthog-ai-observability-report.md';

/**
 * `wizard ai-observability` — flat command, agent-driven skill selection.
 *
 * Wraps the project's LLM client calls with PostHog's AI Observability so they
 * emit `$ai_generation` events into LLM Analytics.
 *
 * The context-mill `ai-observability` group ships ten variants
 * (`ai-observability-openai-python`, `-openai-node`, `-anthropic-python`, …,
 * `-manual-capture`), one per (LLM provider × language). There is no
 * `ai-observability` top-level skill to pre-install, and the wizard has zero
 * bespoke LLM-provider detection — deliberately. Provider picking is the
 * agent's job.
 *
 * `run.skillId` is intentionally omitted so `linear.ts` skips its pre-install
 * step (the `if (config.skillId)` gate on `linear.ts:47`). Instead, the
 * `customPrompt` below drives the agent through:
 *   1. `load_skill_menu` to see the ten `ai-observability-*` variants
 *   2. Scan the project's manifest (package.json / pyproject.toml / …) for a
 *      vendor LLM SDK; `wizard_ask` the user if ambiguous
 *   3. `install_skill` with the picked variant id
 *   4. Follow the installed skill's `SKILL.md` + references end-to-end
 *
 * The variant's own `references/1-begin.md` re-states the same picker logic
 * so the flow works identically when the skill is invoked standalone
 * (`wizard skill ai-observability-openai-python`) — the agent just skips
 * straight to step 4.
 *
 * Stays flat while a single "add AIO to a project" flow is the only action.
 * If a separate uninstrument / diagnose leaf ever lands, restructure into a
 * family with `familyCommandFactory` and publish each leaf as a `cliEntries`
 * entry with `parentCommand: 'ai-observability'` from context-mill.
 */
export const aiObservabilityConfig: ProgramConfig = {
  command: 'ai-observability',
  description: 'Add PostHog AI Observability to your LLM calls',
  id: 'ai-observability',
  steps: AGENT_SKILL_STEPS,
  reportFile: AI_OBSERVABILITY_REPORT_FILE,
  getContentBlocks,
  run: {
    integrationLabel: 'ai-observability',
    // No `skillId`: linear.ts skips its pre-install step (see the gate on
    // `linear.ts:47`), so the agent must load the menu and install the right
    // variant itself. The prompt below tells it how.
    customPrompt: () =>
      [
        "Instrument this project's LLM calls with PostHog AI Observability.",
        '',
        'This flow has no pre-installed skill — you install the right one yourself.',
        '',
        'Step-by-step:',
        '',
        '1. Call `load_skill_menu` with `category: "ai-observability"`. You will',
        '   see ten variants: `ai-observability-openai-python`, `-openai-node`,',
        '   `-anthropic-python`, `-anthropic-node`, `-langchain-python`,',
        '   `-langchain-node`, `-vercel-ai`, `-google-python`, `-google-node`,',
        '   and `-manual-capture`.',
        '',
        '2. Scan the project manifest (`package.json`, `pyproject.toml`,',
        '   `requirements.txt`) for a vendor LLM SDK — `openai`,',
        '   `@anthropic-ai/sdk` / `anthropic`, `langchain` / `@langchain/core`,',
        '   `ai` (Vercel AI SDK), `@google/genai` / `google-genai`. The language',
        '   follows the manifest (`package.json` → Node, Python tooling → Python).',
        '',
        '3. Pick the variant:',
        '   - Exactly one vendor SDK → the matching variant.',
        '   - Multiple SDKs (e.g. LangChain wrapping OpenAI) → prefer the higher',
        '     abstraction (LangChain > direct provider); ask via `wizard_ask` if',
        '     still unsure.',
        '   - No vendor SDK → `ai-observability-manual-capture`.',
        '   - Genuinely ambiguous → `wizard_ask` with a multi-choice picker.',
        '',
        '4. Call `install_skill` with the picked variant id. Then follow that',
        "   skill's `SKILL.md` and references end-to-end. The skill itself will",
        '   install packages, wire OTel, set env vars, and describe verification.',
        '',
        'Make only additive changes — do not touch existing PostHog init, identify',
        'calls, event capture, or dashboards. Those belong to other skills. The',
        `final report is written to ./${AI_OBSERVABILITY_REPORT_FILE}.`,
      ].join('\n'),
    successMessage: `AI Observability configured! View the report at ./${AI_OBSERVABILITY_REPORT_FILE}`,
    reportFile: AI_OBSERVABILITY_REPORT_FILE,
    docsUrl: 'https://posthog.com/docs/ai-observability',
    spinnerMessage: 'Setting up AI Observability...',
    estimatedDurationMinutes: 5,
  },
};
