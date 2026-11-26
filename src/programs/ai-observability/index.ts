import { Harness, Sequence, GPT5_6_TERRA_MODEL } from '@shared/constants';
import type { ProgramConfig } from '@programs/program-contract';
import { headlessOption, regionOption } from '@shared/headless-mode';
import { detectUnambiguousAioSkill } from './detect-skill';

const AI_OBSERVABILITY_REPORT_FILE = 'posthog-ai-observability-report.md';

function buildAioPrompt(preinstalledSkillId?: string): string {
  const skillStep = preinstalledSkillId
    ? `Skill \`${preinstalledSkillId}\` was pre-installed for you at the skill path above. Read its \`SKILL.md\` and references directly — skip \`load_skill_menu\` and \`install_skill\` unless inspecting the code shows a different variant (such as a gateway \`baseURL\` override or a framework wrapping the calls) applies.`
    : `This flow has no pre-installed skill — you install the right one yourself:

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
   packages, wire OTel, set env vars, and describe verification.`;

  return `Instrument this project's LLM calls with PostHog AI Observability.

${skillStep}

Make only additive changes — do not touch existing PostHog init, identify
calls, event capture, or dashboards. Those belong to other skills. The
final report is written to ./${AI_OBSERVABILITY_REPORT_FILE}.`;
}

/**
 * `wizard ai-observability` — wrap the project's LLM client calls so they emit
 * `$ai_generation` events into AI Observability.
 *
 * Pre-installs the `ai-observability-*` variant when the root manifest has a
 * single unambiguous framework or provider (skipping the runtime menu + install
 * round-trip); falls back to runtime discovery on ambiguous, multi-provider,
 * gateway, or monorepo projects.
 */
export const config: ProgramConfig = {
  rankWith: ['decisions'],
  decisions: ['calls_llm_api'],
  binding: {
    sequence: Sequence.linear,
    harness: Harness.pi,
    model: GPT5_6_TERRA_MODEL,
    thinkingLevel: 'high',
  },
  command: 'ai-observability',
  description: 'Add PostHog AI Observability to your LLM calls',
  id: 'ai-observability',
  sdkFeature: 'aiObservability',
  cliOptions: { ...headlessOption, ...regionOption },
  reportFile: AI_OBSERVABILITY_REPORT_FILE,
  run: (session) => {
    const skillId = detectUnambiguousAioSkill(session.installDir);
    return Promise.resolve({
      integrationLabel: 'ai-observability',
      ...(skillId && { skillId }),
      customPrompt: () => buildAioPrompt(skillId),
      successMessage: `AI Observability configured! View the report at ./${AI_OBSERVABILITY_REPORT_FILE}`,
      reportFile: AI_OBSERVABILITY_REPORT_FILE,
      docsUrl: 'https://posthog.com/docs/ai-observability',
      spinnerMessage: 'Setting up AI Observability...',
      estimatedDurationMinutes: 5,
    });
  },
};
