import type { ProgramConfig } from '@lib/programs/program-step';
import { createSkillProgram } from '../agent-skill/index.js';

const REPORT_FILE = 'posthog-ai-observability-report.md';
const DOCS_URL = 'https://posthog.com/docs/ai-engineering';

/**
 * `wizard aio` — set up PostHog AI observability (formerly LLM Analytics).
 *
 * Standalone entry point for the same instrumentation that the default flow
 * offers as an opt-in add-on (the `AdditionalFeature.LLM` stop-hook step).
 * Here it's a first-class program: install the `llm-analytics-setup` skill and
 * run its workflow directly, on demand, without the full integration flow.
 */
export const aioConfig: ProgramConfig = createSkillProgram({
  skillId: 'llm-analytics-setup',
  command: 'aio',
  id: 'ai-observability',
  description: 'Set up PostHog AI observability (LLM analytics)',
  integrationLabel: 'llm-analytics-setup',
  customPrompt:
    'Integrate AI observability with PostHog for this project. Follow the ' +
    'installed llm-analytics-setup skill: detect the LLM SDK(s) in use, wire ' +
    'up PostHog AI observability, and instrument the LLM calls. Update the ' +
    'report markdown file when complete.',
  successMessage:
    'AI observability configured! You can view the report at ./posthog-ai-observability-report.md',
  reportFile: REPORT_FILE,
  docsUrl: DOCS_URL,
  spinnerMessage: 'Setting up AI observability...',
  estimatedDurationMinutes: 5,
  requires: ['posthog-integration'],
});
