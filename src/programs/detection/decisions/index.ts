/** Decisions API detection: classify a project along every onboarding dimension with OpenAI's Decisions API. */

import path from 'path';
import { runtimeEnv } from '@env';
import { Integration } from '@shared/constants';
import { logToFile } from '@utils/debug';
import {
  createDecision,
  DECISIONS_MODEL,
  type Decision,
  type DecisionAnswer,
  type DecisionQuestion,
} from './client';
import {
  AI_KINDS,
  AI_PREFIX,
  CORE_CHOICES,
  DECISION_QUESTIONS,
  FRAMEWORK_PRESENCE_PREFIX,
  LANGUAGE_PRESENCE_PREFIX,
  PRESENCE_LANGUAGES,
  SIGNAL_QUESTIONS,
  VARIANT_QUESTIONS,
  WAREHOUSE_KINDS,
  WAREHOUSE_PREFIX,
  integrationFromChoice,
  variantKeyFor,
  type CoreChoiceKey,
  type SignalKey,
  type VariantKey,
} from './questions';
import { renderDecisionInput, scanProject } from './state';

export type DecisionsChoice = {
  choice: string;
  /** Probability of the chosen value; the routing gates read this, not `confidence`. */
  probability: number;
  confidence: number;
  probabilities: Record<string, number>;
};

export type DecisionsDetectionReport = {
  framework: (DecisionsChoice & { integration: Integration | null }) | null;
  /** The variant answer relevant to the framework choice (e.g. Next.js router), if any. */
  variant: (DecisionsChoice & { key: VariantKey }) | null;
  variants: Partial<Record<VariantKey, DecisionsChoice>>;
  language: DecisionsChoice | null;
  packageManager: DecisionsChoice | null;
  useCase: DecisionsChoice | null;
  industry: DecisionsChoice | null;
  /** Predicate probabilities; null when refused or unanswered. */
  signals: Record<SignalKey, number | null>;
  warehouseSources: Record<string, number>;
  aiSources: Record<string, number>;
  frameworkPresence: Record<string, number>;
  languagePresence: Record<string, number>;
  /** Question names refused or lost to a failed batch. */
  unanswered: string[];
  calls: number;
  failedCalls: number;
  model: string;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  };
  estCostUsd: number;
  durationMs: number;
  inputBytes: number;
  subprojects?: Array<{ path: string; report: DecisionsDetectionReport }>;
};

/** Per-attempt timeout; the client retries transient failures once. */
const DECISIONS_TIMEOUT_MS = 8_000;
/** Reported public-beta input price for gpt-6-luna; unverified against OpenAI's docs. */
const DECISIONS_USD_PER_INPUT_TOKEN = 0.1 / 1_000_000;
/** Questions per request; the API's limit is undocumented, so larger catalogs split into parallel calls. */
export const DECISIONS_MAX_QUESTIONS_PER_CALL = 64;
/** Descend into subprojects when is_monorepo clears this. */
export const DECISIONS_MONOREPO_PROBABILITY = 0.8;

export function getOpenAiApiKey(): string | undefined {
  return runtimeEnv('OPENAI_API_KEY') || undefined;
}

export function chunkQuestions<T>(
  questions: readonly T[],
  size: number,
): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < questions.length; i += size) {
    batches.push(questions.slice(i, i + size));
  }
  return batches;
}

/** Pair a batch's answers with its questions by position; throws if the API names a different question. */
export function answersByName(
  questions: readonly DecisionQuestion[],
  decision: Decision,
): Map<string, DecisionAnswer> {
  if (decision.answers.length !== questions.length) {
    throw new Error(
      `Decisions API returned ${decision.answers.length} answers for ${questions.length} questions`,
    );
  }
  const answers = new Map<string, DecisionAnswer>();
  for (const [i, question] of questions.entries()) {
    const answer = decision.answers[i];
    if (answer.name !== null && answer.name !== question.name) {
      throw new Error(
        `Decisions API answer ${i} is "${answer.name}", expected "${question.name}"`,
      );
    }
    answers.set(question.name, answer);
  }
  return answers;
}

function toChoice(answer: DecisionAnswer | undefined): DecisionsChoice | null {
  if (answer?.type !== 'choice') return null;
  const probabilities = Object.fromEntries(
    answer.probabilities.map((p) => [String(p.value), p.probability]),
  );
  const choice = String(answer.choice);
  return {
    choice,
    probability: probabilities[choice] ?? answer.confidence,
    confidence: answer.confidence,
    probabilities,
  };
}

function toProbability(answer: DecisionAnswer | undefined): number | null {
  return answer?.type === 'predicate' ? answer.probability : null;
}

/** Map answers onto the report's classification fields. Pure, for testing. */
export function classify(
  answers: ReadonlyMap<string, DecisionAnswer>,
): Pick<
  DecisionsDetectionReport,
  | 'framework'
  | 'variant'
  | 'variants'
  | 'language'
  | 'packageManager'
  | 'useCase'
  | 'industry'
  | 'signals'
  | 'warehouseSources'
  | 'aiSources'
  | 'frameworkPresence'
  | 'languagePresence'
  | 'unanswered'
> {
  const choiceFor = (key: CoreChoiceKey) =>
    toChoice(answers.get(CORE_CHOICES[key].name));

  const variants: Partial<Record<VariantKey, DecisionsChoice>> = {};
  for (const [key, question] of Object.entries(VARIANT_QUESTIONS) as Array<
    [VariantKey, DecisionQuestion]
  >) {
    const answer = toChoice(answers.get(question.name));
    if (answer) variants[key] = answer;
  }

  const signals = Object.fromEntries(
    (
      Object.entries(SIGNAL_QUESTIONS) as Array<[SignalKey, DecisionQuestion]>
    ).map(([key, question]) => [
      key,
      toProbability(answers.get(question.name)),
    ]),
  ) as Record<SignalKey, number | null>;

  const collect = (prefix: string, kinds: readonly string[]) => {
    const out: Record<string, number> = {};
    for (const kind of kinds) {
      const p = toProbability(answers.get(`${prefix}${kind}`));
      if (p !== null) out[kind] = p;
    }
    return out;
  };

  const frameworkAnswer = choiceFor('framework');
  const framework = frameworkAnswer
    ? {
        ...frameworkAnswer,
        integration: integrationFromChoice(frameworkAnswer.choice),
      }
    : null;
  const variantKey = variantKeyFor(framework?.integration ?? null);
  const variantAnswer = variantKey ? variants[variantKey] : undefined;

  return {
    framework,
    variant:
      variantKey && variantAnswer
        ? { key: variantKey, ...variantAnswer }
        : null,
    variants,
    language: choiceFor('language'),
    packageManager: choiceFor('packageManager'),
    useCase: choiceFor('useCase'),
    industry: choiceFor('industry'),
    signals,
    warehouseSources: collect(WAREHOUSE_PREFIX, WAREHOUSE_KINDS),
    aiSources: collect(AI_PREFIX, AI_KINDS),
    frameworkPresence: collect(
      FRAMEWORK_PRESENCE_PREFIX,
      Object.values(Integration),
    ),
    languagePresence: collect(LANGUAGE_PRESENCE_PREFIX, PRESENCE_LANGUAGES),
    unanswered: DECISION_QUESTIONS.map((q) => q.name).filter((name) => {
      const answer = answers.get(name);
      return !answer || answer.type === 'refusal';
    }),
  };
}

export type DetectWithDecisionsOptions = {
  /** Fan out one detection per manifest-bearing subdirectory when is_monorepo is high. */
  descend?: boolean;
  fetchImpl?: typeof fetch;
  maxQuestionsPerCall?: number;
};

/** Classify the project with the Decisions API. Throws without OPENAI_API_KEY or when the framework batch fails. */
export async function detectWithDecisions(
  installDir: string,
  options: DetectWithDecisionsOptions = {},
): Promise<DecisionsDetectionReport> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set — Decisions detection needs it.',
    );
  }
  const { state, subprojectDirs } = scanProject(installDir);
  const input = renderDecisionInput(state);
  const batches = chunkQuestions(
    DECISION_QUESTIONS,
    options.maxQuestionsPerCall ?? DECISIONS_MAX_QUESTIONS_PER_CALL,
  );
  const clientOptions = {
    apiKey,
    baseUrl: runtimeEnv('OPENAI_BASE_URL') || undefined,
    timeoutMs: DECISIONS_TIMEOUT_MS,
    maxRetries: 1,
    fetchImpl: options.fetchImpl,
  };

  const started = Date.now();
  const results = await Promise.allSettled(
    batches.map(async (questions) => {
      const decision = await createDecision(
        { model: DECISIONS_MODEL, input, questions },
        clientOptions,
      );
      return { decision, answers: answersByName(questions, decision) };
    }),
  );
  const durationMs = Date.now() - started;

  // The first batch holds the framework question; without it there is nothing to route on.
  const first = results[0];
  if (first.status === 'rejected') throw first.reason;

  const answers = new Map<string, DecisionAnswer>();
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  let failedCalls = 0;
  for (const result of results) {
    if (result.status === 'rejected') {
      failedCalls++;
      logToFile(`[decisions] batch failed: ${String(result.reason)}`);
      continue;
    }
    for (const [name, answer] of result.value.answers)
      answers.set(name, answer);
    const batchUsage = result.value.decision.usage;
    usage.inputTokens += batchUsage.input_tokens;
    usage.cachedInputTokens +=
      batchUsage.input_tokens_details?.cached_tokens ?? 0;
    usage.outputTokens += batchUsage.output_tokens;
  }

  const report: DecisionsDetectionReport = {
    ...classify(answers),
    calls: batches.length,
    failedCalls,
    model: first.value.decision.model,
    usage,
    estCostUsd: usage.inputTokens * DECISIONS_USD_PER_INPUT_TOKEN,
    durationMs,
    inputBytes: JSON.stringify(input).length,
  };

  if (
    options.descend === true &&
    (report.signals.isMonorepo ?? 0) >= DECISIONS_MONOREPO_PROBABILITY &&
    subprojectDirs.length > 0
  ) {
    const subprojects = await Promise.all(
      subprojectDirs.map((dir) =>
        detectWithDecisions(path.join(installDir, dir), {
          ...options,
          descend: false,
        })
          .then((subReport) => ({ path: dir, report: subReport }))
          .catch(() => null),
      ),
    );
    report.subprojects = subprojects.filter(
      (s): s is { path: string; report: DecisionsDetectionReport } =>
        s !== null,
    );
  }

  return report;
}

/** Kinds whose probability clears the threshold, strongest first. */
export function sourceHits(
  sources: Record<string, number>,
  threshold = 0.5,
): Array<[string, number]> {
  return Object.entries(sources)
    .filter(([, p]) => p >= threshold)
    .sort(([, a], [, b]) => b - a);
}

/** Compact summary for frameworkContext and logs, without probability maps. */
export function summarizeDecisionsReport(
  report: DecisionsDetectionReport,
): Record<string, unknown> {
  const round = (n: number | null): number | null =>
    n === null ? null : Math.round(n * 100) / 100;
  const hits = (sources: Record<string, number>) =>
    sourceHits(sources)
      .map(([kind, p]) => `${kind}:${p.toFixed(2)}`)
      .join(', ');
  const signals = Object.fromEntries(
    Object.entries(report.signals).map(([key, p]) => [key, round(p)]),
  );
  return {
    framework: report.framework?.choice ?? null,
    frameworkProbability: round(report.framework?.probability ?? null),
    ...(report.variant
      ? {
          variant: `${report.variant.key}=${report.variant.choice}`,
          variantProbability: round(report.variant.probability),
        }
      : {}),
    language: report.language?.choice ?? null,
    packageManager: report.packageManager?.choice ?? null,
    useCase: report.useCase?.choice ?? null,
    industry: report.industry?.choice ?? null,
    ...signals,
    warehouseSources: hits(report.warehouseSources),
    aiSources: hits(report.aiSources),
    frameworksPresent: hits(report.frameworkPresence),
    languagesPresent: hits(report.languagePresence),
    ...(report.subprojects
      ? {
          subprojects: report.subprojects
            .map((s) => `${s.path}=${s.report.framework?.choice ?? 'none'}`)
            .join(', '),
        }
      : {}),
    unanswered: report.unanswered.length,
    calls: report.calls,
    failedCalls: report.failedCalls,
    model: report.model,
    durationMs: report.durationMs,
    inputTokens: report.usage.inputTokens,
  };
}
