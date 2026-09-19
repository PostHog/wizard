/**
 * Jev classifier detection — one TypeSafe systemOne call classifies the
 * project along every onboarding dimension. Prototype: dev builds only,
 * driven by WIZARD_JEV_DETECTION (see route.ts). Sits next to the other
 * detection tools (framework, agentic, features) so it's discoverable.
 */

import path from 'path';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { runtimeEnv } from '@env';
import { Integration } from '@lib/constants';
import { scanProject } from './state.js';
import {
  AI_KINDS,
  AI_NOUL_PREFIX,
  FRAMEWORK_PRESENCE_PREFIX,
  JEV_QUESTIONS,
  LANGUAGE_PRESENCE_PREFIX,
  PRESENCE_LANGUAGES,
  PRESENCE_QUESTIONS,
  SOURCE_QUESTIONS,
  WAREHOUSE_KINDS,
  WAREHOUSE_NOUL_PREFIX,
  integrationFromChoice,
  variantKeyFor,
  type VariantKey,
} from './questions.js';

export type JevChoiceAnswer = {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

export type JevDetectionReport = {
  framework: JevChoiceAnswer & { integration: Integration | null };
  /** The sub-framework answer relevant to the framework choice (e.g. Next.js router), if any. */
  variant: (JevChoiceAnswer & { key: VariantKey }) | null;
  /** Every speculative variant answer, for shadow comparison and benchmarking. */
  variants: Record<VariantKey, JevChoiceAnswer>;
  language: JevChoiceAnswer;
  packageManager: JevChoiceAnswer;
  useCase: JevChoiceAnswer;
  industry: JevChoiceAnswer;
  /** Noul probabilities (0–1), keyed by signal. */
  signals: {
    isMonorepo: number;
    typescript: number;
    hasPosthog: number;
    hasStripe: number;
    usesLlm: number;
    hasAuth: number;
    webFrontend: number;
    isMobile: number;
    structuredLogs: number;
    openTelemetry: number;
  };
  /** Warehouse-source noul probabilities keyed by registry kind (core tier). */
  warehouseSources: Record<string, number>;
  /** AI/LLM source noul probabilities keyed by registry kind. */
  aiSources: Record<string, number>;
  /** Multi-label presence: "is X anywhere in the repo", keyed by Integration value. */
  frameworkPresence: Record<string, number>;
  /** Multi-label presence per language. */
  languagePresence: Record<string, number>;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  estCostUsd: number;
  durationMs: number;
  stateBytes: number;
  /** Per-subdirectory classifications when monorepo descent ran (one Jev call each, in parallel). */
  subprojects?: Array<{ path: string; report: JevDetectionReport }>;
};

/** Per-attempt timeout; the SDK retries once on transient failures. */
const JEV_TIMEOUT_MS = 8_000;
/** jev-1.13 input pricing; output is free. */
const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
/** Descend into subprojects when is_monorepo clears this. */
export const JEV_MONOREPO_CONFIDENCE = 0.8;

export function getTypesafeApiKey(): string | undefined {
  return runtimeEnv('TYPESAFE_API_KEY') || undefined;
}

/**
 * Classify the project with one Jev systemOne call. Throws without an API
 * key. With `descend` (default off), a high is_monorepo answer fans out one
 * additional call per manifest-bearing subdirectory, all in parallel — the
 * decision tree lives here in code; Jev answers each node.
 */
export async function detectWithJev(
  installDir: string,
  options: { descend?: boolean } = {},
): Promise<JevDetectionReport> {
  const apiKey = getTypesafeApiKey();
  if (!apiKey) {
    throw new Error('TYPESAFE_API_KEY is not set — Jev detection needs it.');
  }
  const { state, subprojectDirs } = scanProject(installDir);
  const stateBytes = JSON.stringify(state).length;
  const client = new TypeSafeClient({
    apiKey,
    timeout: JEV_TIMEOUT_MS,
    retry: { maxRetries: 1 },
  });

  const started = Date.now();
  // Generated source nouls ride along in the same call; the cast keeps the
  // core answers typed (runtime carries a superset of the declared keys).
  const questions = {
    ...JEV_QUESTIONS,
    ...SOURCE_QUESTIONS,
    ...PRESENCE_QUESTIONS,
  } as typeof JEV_QUESTIONS;
  const result = await client.systemOne({ state, questions });
  const durationMs = Date.now() - started;

  const { answers, usage, model } = result;
  const toChoice = (answer: {
    choice: string;
    confidence: number;
    probabilities: Readonly<Record<string, number>>;
  }): JevChoiceAnswer => ({
    choice: answer.choice,
    confidence: answer.confidence,
    probabilities: { ...answer.probabilities },
  });

  const rawAnswers = answers as unknown as Record<
    string,
    { noul?: number } | undefined
  >;
  const collectNouls = (
    prefix: string,
    kinds: readonly string[],
  ): Record<string, number> =>
    Object.fromEntries(
      kinds.map((kind) => [kind, rawAnswers[`${prefix}${kind}`]?.noul ?? 0]),
    );

  const integration = integrationFromChoice(answers.framework.choice);
  const variants: Record<VariantKey, JevChoiceAnswer> = {
    nextjs_router: toChoice(answers.nextjs_router),
    react_native_flavor: toChoice(answers.react_native_flavor),
    astro_rendering: toChoice(answers.astro_rendering),
    tanstack_router_mode: toChoice(answers.tanstack_router_mode),
    laravel_stack: toChoice(answers.laravel_stack),
  };
  const variantKey = variantKeyFor(integration);

  const report: JevDetectionReport = {
    framework: {
      ...toChoice(answers.framework),
      integration,
    },
    variant: variantKey ? { key: variantKey, ...variants[variantKey] } : null,
    variants,
    language: toChoice(answers.language),
    packageManager: toChoice(answers.package_manager),
    useCase: toChoice(answers.use_case),
    industry: toChoice(answers.industry),
    signals: {
      isMonorepo: answers.is_monorepo.noul,
      typescript: answers.typescript.noul,
      hasPosthog: answers.has_posthog.noul,
      hasStripe: answers.has_stripe.noul,
      usesLlm: answers.uses_llm.noul,
      hasAuth: answers.has_auth.noul,
      webFrontend: answers.web_frontend.noul,
      isMobile: answers.is_mobile.noul,
      structuredLogs: answers.logs_structured.noul,
      openTelemetry: answers.logs_otel.noul,
    },
    warehouseSources: collectNouls(WAREHOUSE_NOUL_PREFIX, WAREHOUSE_KINDS),
    aiSources: collectNouls(AI_NOUL_PREFIX, AI_KINDS),
    frameworkPresence: collectNouls(
      FRAMEWORK_PRESENCE_PREFIX,
      Object.values(Integration),
    ),
    languagePresence: collectNouls(
      LANGUAGE_PRESENCE_PREFIX,
      PRESENCE_LANGUAGES,
    ),
    model,
    usage: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
    },
    estCostUsd: usage.input_tokens * JEV_USD_PER_INPUT_TOKEN,
    durationMs,
    stateBytes,
  };

  if (
    options.descend === true &&
    report.signals.isMonorepo >= JEV_MONOREPO_CONFIDENCE &&
    subprojectDirs.length > 0
  ) {
    const subprojects = await Promise.all(
      subprojectDirs.map((dir) =>
        detectWithJev(path.join(installDir, dir), { descend: false })
          .then((subReport) => ({ path: dir, report: subReport }))
          .catch(() => null),
      ),
    );
    report.subprojects = subprojects.filter(
      (s): s is { path: string; report: JevDetectionReport } => s !== null,
    );
  }

  return report;
}

/** Kinds whose noul probability clears the threshold, strongest first. */
export function sourceHits(
  sources: Record<string, number>,
  threshold = 0.5,
): Array<[string, number]> {
  return Object.entries(sources)
    .filter(([, p]) => p >= threshold)
    .sort(([, a], [, b]) => b - a);
}

/** Compact summary for frameworkContext / logs — no probability maps. */
export function summarizeJevReport(
  report: JevDetectionReport,
): Record<string, unknown> {
  const round = (n: number): number => Math.round(n * 100) / 100;
  return {
    framework: report.framework.choice,
    frameworkConfidence: round(report.framework.confidence),
    ...(report.variant
      ? {
          variant: `${report.variant.key}=${report.variant.choice}`,
          variantConfidence: round(report.variant.confidence),
        }
      : {}),
    language: report.language.choice,
    packageManager: report.packageManager.choice,
    useCase: report.useCase.choice,
    industry: report.industry.choice,
    isMonorepo: round(report.signals.isMonorepo),
    typescript: round(report.signals.typescript),
    hasPosthog: round(report.signals.hasPosthog),
    hasStripe: round(report.signals.hasStripe),
    usesLlm: round(report.signals.usesLlm),
    hasAuth: round(report.signals.hasAuth),
    webFrontend: round(report.signals.webFrontend),
    isMobile: round(report.signals.isMobile),
    structuredLogs: round(report.signals.structuredLogs),
    openTelemetry: round(report.signals.openTelemetry),
    warehouseSources: sourceHits(report.warehouseSources)
      .map(([kind, p]) => `${kind}:${round(p)}`)
      .join(', '),
    aiSources: sourceHits(report.aiSources)
      .map(([kind, p]) => `${kind}:${round(p)}`)
      .join(', '),
    frameworksPresent: sourceHits(report.frameworkPresence)
      .map(([kind, p]) => `${kind}:${round(p)}`)
      .join(', '),
    languagesPresent: sourceHits(report.languagePresence)
      .map(([kind, p]) => `${kind}:${round(p)}`)
      .join(', '),
    ...(report.subprojects
      ? {
          subprojects: report.subprojects
            .map((s) => `${s.path}=${s.report.framework.choice}`)
            .join(', '),
        }
      : {}),
    model: report.model,
    durationMs: report.durationMs,
    inputTokens: report.usage.inputTokens,
  };
}
