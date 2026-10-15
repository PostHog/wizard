/**
 * What posthog-integration asks the Decisions judgment service, and how the
 * answers reach the run. Shadow answers are only logged; primary answers
 * become facts the agents read.
 */

import type { Integration } from '@shared/constants';
import { logToFile } from '@utils/debug';
import type { ProgramSession } from '../program-session';
import type { CiRunnerContext } from '../runner-context';
import { loadWizardFlags } from '../wizard-flags';
import {
  actionableAnswer,
  actionableProbability,
  askDecisions,
  getDecisionsScan,
  decisionsTransport,
  FRAMEWORK_QUESTION,
  getDecisionsMode,
  IS_MONOREPO_QUESTION,
  renderDecisionInput,
  routeIntegration,
  type DecisionQuestionSpec,
  type ProgramDecisions,
} from '../detection/decisions';

/** At or above: the task applies. At or below: the code shows no sign of it. */
const APPLIES = 0.6;
const ABSENT = 0.1;

const PRODUCT_CATEGORY_QUESTION: DecisionQuestionSpec = {
  name: 'product_category',
  kind: 'choice',
  instructions:
    'Which kind of product does this code build? Judge from its routes, dependencies and file names.',
  choices: {
    saas: 'Software-as-a-service product with user accounts',
    ecommerce: 'Online store or checkout-centric product',
    marketing_site: 'Marketing or landing site',
    content_site: 'Documentation, blog or content site',
    internal_tool: 'Internal dashboard or back-office tool',
    ai_app: 'AI-first product (chat, agents, generation)',
    api_service: 'Headless API or backend service',
    mobile_app: 'Mobile application',
    library_or_cli: 'Library, SDK or developer CLI',
    other: null,
  },
  purpose: 'Shape the event plan and starter dashboard.',
};

const CALLS_LLM_API_QUESTION: DecisionQuestionSpec = {
  name: 'calls_llm_api',
  kind: 'predicate',
  instructions:
    'App code calls an LLM API (OpenAI, Anthropic, Gemini, …), with or without an SDK.',
  purpose: 'Decide whether AI Observability applies.',
};

const STRUCTURED_LOGGING_QUESTION: DecisionQuestionSpec = {
  name: 'structured_logging',
  kind: 'predicate',
  instructions:
    'The project uses a structured logging library, such as winston, pino, structlog, loguru, monolog, zap, slog or tracing.',
  purpose: 'Decide whether Logs applies.',
};

const OTEL_EXPORTER_QUESTION: DecisionQuestionSpec = {
  name: 'otel_exporter',
  kind: 'predicate',
  instructions:
    'The project uses OpenTelemetry or an OTLP exporter (@opentelemetry/*, opentelemetry-sdk, an otel collector config).',
  purpose: 'Decide whether Logs can use the OTLP path.',
};

export const POSTHOG_INTEGRATION_DECISIONS: ProgramDecisions = {
  questions: [
    FRAMEWORK_QUESTION,
    IS_MONOREPO_QUESTION,
    PRODUCT_CATEGORY_QUESTION,
    CALLS_LLM_API_QUESTION,
    STRUCTURED_LOGGING_QUESTION,
    OTEL_EXPORTER_QUESTION,
  ],
  compare: (session, answers) => {
    const framework = answers.framework;
    const staticIntegration = session.integration ?? null;
    const judged = framework?.kind === 'choice' ? framework.choice : null;
    return {
      framework_static: staticIntegration,
      framework_decisions: judged,
      framework_agree: judged === (staticIntegration ?? 'none'),
    };
  },
};

/**
 * What the primary answers tell the agents, one line each. Empty in shadow
 * mode, and for anything the model was unsure of.
 */
export function decisionFacts(session: ProgramSession): string[] {
  const facts: string[] = [];
  const category = actionableAnswer(session, 'product_category');
  if (
    category?.kind === 'choice' &&
    category.choice !== 'other' &&
    category.probability >= APPLIES
  ) {
    facts.push(
      `Product category: ${category.choice}. Shape the event plan around it.`,
    );
  }
  const describe = (
    name: string,
    applies: string,
    absent: string,
  ): string | null => {
    const p = actionableProbability(session, name);
    if (p === null) return null;
    if (p >= APPLIES) return applies;
    if (p <= ABSENT) return absent;
    return null;
  };
  for (const line of [
    describe(
      'calls_llm_api',
      'App code appears to call an LLM API: AI Observability likely applies.',
      'App code shows no LLM API calls: AI Observability likely does not apply. Confirm before skipping it, and say why in the setup report.',
    ),
    describe(
      'structured_logging',
      'The project uses a structured logging library: Logs likely applies.',
      'The project shows no structured logging library.',
    ),
    describe(
      'otel_exporter',
      'The project already uses OpenTelemetry: prefer the OTLP path for Logs.',
      'The project shows no OpenTelemetry setup.',
    ),
  ]) {
    if (line) facts.push(line);
  }
  return facts;
}

/**
 * CI only, primary mode: ask for the framework when static detection found
 * none, rather than abort. Logs in first, since the call needs the gateway key.
 * Never throws: on any failure the run aborts as it did before.
 */
export async function judgeMissingIntegration(
  session: ProgramSession,
  runner: CiRunnerContext,
): Promise<Integration | undefined> {
  try {
    return await askForMissingIntegration(session, runner);
  } catch (error) {
    // The caller's abort explains a missing framework better than this error would.
    logToFile(`[decisions] framework fill-in failed: ${String(error)}`);
    return undefined;
  }
}

async function askForMissingIntegration(
  session: ProgramSession,
  runner: CiRunnerContext,
): Promise<Integration | undefined> {
  const flags = await loadWizardFlags();
  if (getDecisionsMode(flags.flags) !== 'primary') return undefined;
  await runner.authenticate('posthog-integration');
  const transport = decisionsTransport(session);
  if (!transport) return undefined;
  const result = await askDecisions(
    renderDecisionInput(getDecisionsScan(session)),
    [FRAMEWORK_QUESTION],
    { transport },
  );
  const routed = routeIntegration(result.answers.framework, undefined);
  logToFile(
    `[decisions] static detection found no framework; decisions=${
      routed.integration ?? 'none'
    }${result.error ? ` error=${result.error}` : ''}`,
  );
  return routed.integration;
}
