/**
 * The run's project traits: what a flow's `when` conditions and its nodes'
 * skill criteria read. Static detection sets them first; a Decisions answer
 * fills or confirms one only in primary mode, and an unsure answer leaves it
 * absent. Context-mill never sees a trait name, only the tags `traitTags` maps
 * values to.
 */

import { frameworkTag, type TraitTags } from '@shared/skill-resolution';
import type { ProgramSession } from './program-session';
// Type-only: the Decisions service stays out of production bundles.
import type {
  DecisionAnswer,
  DecisionsResult,
} from './detection/decisions/types';
import type { QuestionKey } from './detection/decisions/questions';
import {
  judgedValueWins,
  LIKELY_PROBABILITY,
  UNLIKELY_PROBABILITY,
  UNSPECIFIC_CHOICES,
} from './detection/confidence';

/** frameworkContext key holding the run's `DecisionsResult`. */
export const DECISIONS_KEY = 'decisions';

export type TraitName =
  | 'framework'
  | 'architecture'
  | 'productCategory'
  | 'callsLlmApi'
  | 'structuredLogging'
  | 'otel'
  | 'observabilityStack'
  | 'serverRuntime'
  | 'webFrontend'
  | 'buildTool'
  | 'deployPlatform'
  | 'shipsMinifiedJs'
  | 'ownsDatabase'
  | 'billingCode'
  | 'isMcpServer'
  | 'primaryUserFlow'
  | 'userLogin';

/** A predicate trait's value is `yes` or `no`; a choice trait's is the choice. */
export type Trait = {
  value: string;
  source: 'static' | 'decisions';
  confidence?: number;
};

export type Traits = Partial<Record<TraitName, Trait>>;

type Adapter = {
  trait: TraitName;
  /** A predicate's values, when they differ from `yes` and `no`. */
  values?: { yes: string; no: string };
};

/** Which trait each Decisions question feeds. Exhaustive: a new question needs a trait. */
export const QUESTION_TRAITS: Readonly<Record<QuestionKey, Adapter>> = {
  framework: { trait: 'framework' },
  is_monorepo: {
    trait: 'architecture',
    values: { yes: 'monorepo', no: 'single-app' },
  },
  product_category: { trait: 'productCategory' },
  web_frontend: { trait: 'webFrontend' },
  server_runtime: { trait: 'serverRuntime' },
  primary_user_flow: { trait: 'primaryUserFlow' },
  user_login: { trait: 'userLogin' },
  calls_llm_api: { trait: 'callsLlmApi' },
  structured_logging: { trait: 'structuredLogging' },
  otel_exporter: { trait: 'otel' },
  observability_stack: { trait: 'observabilityStack' },
  ships_minified_js: { trait: 'shipsMinifiedJs' },
  build_tool: { trait: 'buildTool' },
  deploy_platform: { trait: 'deployPlatform' },
  owns_database: { trait: 'ownsDatabase' },
  billing_code: { trait: 'billingCode' },
  is_mcp_server: { trait: 'isMcpServer' },
};

/** The trait value an answer supports, or undefined when the answer is unsure. */
export function answerValue(
  answer: DecisionAnswer,
  values: { yes: string; no: string } = { yes: 'yes', no: 'no' },
): string | undefined {
  if (answer.kind === 'predicate') {
    if (answer.probability >= LIKELY_PROBABILITY) return values.yes;
    if (answer.probability <= UNLIKELY_PROBABILITY) return values.no;
    return undefined;
  }
  if (answer.probability < LIKELY_PROBABILITY) return undefined;
  return UNSPECIFIC_CHOICES.has(answer.choice) ? undefined : answer.choice;
}

/**
 * Whether this program may act on the run's Decisions answers. The one place
 * a mode per program lands; today only a run in primary mode qualifies, and no
 * switch sets primary.
 */
function decisionsActionable(
  result: DecisionsResult | undefined,
  _programId: string,
): result is DecisionsResult {
  return result?.mode === 'primary';
}

/** The run's traits for one program: static detection, then confident Decisions answers. */
export function getTraits(session: ProgramSession, programId: string): Traits {
  const traits: Traits = {};
  if (session.integration) {
    traits.framework = { value: session.integration, source: 'static' };
  }

  const result = session.frameworkContext[DECISIONS_KEY] as
    | DecisionsResult
    | undefined;
  if (!decisionsActionable(result, programId)) return traits;

  for (const [question, adapter] of Object.entries(QUESTION_TRAITS)) {
    const answer = result.answers[question];
    if (!answer) continue;
    const value = answerValue(answer, adapter.values);
    if (value === undefined) continue;
    const current = traits[adapter.trait];
    if (current && !judgedValueWins(value, answer.probability, current.value)) {
      continue;
    }
    traits[adapter.trait] = {
      value,
      source: 'decisions',
      confidence: answer.probability,
    };
  }
  return traits;
}

/** Predicate traits whose `yes` stands for a tag skills carry. */
const YES_TAGS: Partial<Record<TraitName, string>> = {
  serverRuntime: 'server',
  webFrontend: 'browser',
  otel: 'otlp',
};

/** Each trait's value as the tags skill criteria require or prefer. */
export function traitTags(traits: Traits): TraitTags {
  const tags: Record<string, string[]> = {};
  for (const [name, trait] of Object.entries(traits) as [TraitName, Trait][]) {
    if (name === 'framework') {
      tags[name] = [frameworkTag(trait.value)];
    } else if (trait.value === 'yes' || trait.value === 'no') {
      const tag = YES_TAGS[name];
      if (tag && trait.value === 'yes') tags[name] = [tag];
    } else {
      tags[name] = [trait.value.replace(/_/g, '-')];
    }
  }
  return tags;
}
