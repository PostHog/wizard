/**
 * The Jev question catalog — one systemOne fan-out covering framework
 * identity plus every onboarding dimension. Speculative questions are free:
 * all questions in a call are evaluated in parallel with no added latency.
 */

import { choice, noul, type NoulQuestion } from '@typesafe-ai/sdk';
import { Integration } from '@lib/constants';
import {
  SOURCE_DETECTORS,
  AI_SOURCE_KINDS,
  CORE_SOURCE_KINDS,
} from '@lib/warehouse-sources/registry';
import type { SourceDetector } from '@lib/warehouse-sources/types';

/** Choice label meaning "no supported framework or language detected". */
export const NO_FRAMEWORK = 'none';

/**
 * One discriminating description per Integration, keyed by enum value.
 * Kept in sync with the Integration enum by a unit test.
 */
export const FRAMEWORK_CRITERIA: Record<string, string> = {
  [Integration.nextjs]:
    'Next.js — "next" dependency, next.config.*, app/ or pages/ router',
  [Integration.nuxt]: 'Nuxt — "nuxt" dependency, nuxt.config.*',
  [Integration.vue]:
    'Vue SPA — "vue" dependency without Nuxt or another meta-framework',
  [Integration.reactRouter]:
    'React Router v7 framework mode (formerly Remix) — "react-router" with @react-router/* packages',
  [Integration.tanstackStart]:
    'TanStack Start — "@tanstack/react-start" dependency',
  [Integration.tanstackRouter]:
    'TanStack Router SPA — "@tanstack/react-router" without TanStack Start',
  [Integration.reactNative]:
    'React Native or Expo mobile app — "react-native" or "expo" dependency',
  [Integration.angular]: 'Angular — "@angular/core" dependency, angular.json',
  [Integration.astro]: 'Astro — "astro" dependency, astro.config.*',
  [Integration.django]: 'Django — manage.py, django in requirements/pyproject',
  [Integration.flask]: 'Flask — flask in requirements/pyproject',
  [Integration.fastapi]: 'FastAPI — fastapi in requirements/pyproject',
  [Integration.laravel]:
    'Laravel — composer.json with laravel/framework, artisan file',
  [Integration.sveltekit]:
    'SvelteKit — "@sveltejs/kit" dependency, svelte.config.js',
  [Integration.flutter]: 'Flutter — pubspec.yaml with a flutter sdk entry',
  [Integration.kmp]:
    'Kotlin Multiplatform — build.gradle.kts with the kotlin multiplatform plugin',
  [Integration.swift]:
    'Native iOS/macOS Swift app — .xcodeproj, Package.swift, or Podfile',
  [Integration.android]:
    'Native Android app — build.gradle with com.android.application',
  [Integration.rails]:
    'Ruby on Rails — Gemfile with rails, config/application.rb',
  [Integration.elixir]: 'Elixir (often Phoenix) — mix.exs',
  [Integration.go]: 'Go service or app — go.mod',
  [Integration.rust]: 'Rust — Cargo.toml',
  [Integration.java]:
    'JVM app (Maven or Gradle) that is not Android or Kotlin Multiplatform',
  [Integration.python]:
    'Python project with no recognized web framework (scripts, ML, CLI)',
  [Integration.ruby]: 'Ruby project that is not Rails',
  [Integration.javascript_web]:
    'Browser JavaScript/TypeScript frontend with no recognized framework',
  [Integration.javascriptNode]:
    'Node.js backend, CLI, or library with no recognized framework',
  [NO_FRAMEWORK]: 'No supported framework or language is identifiable',
};

const LANGUAGE_CRITERIA = {
  typescript: null,
  javascript: null,
  python: null,
  ruby: null,
  php: null,
  go: null,
  rust: null,
  java: null,
  kotlin: null,
  swift: null,
  dart: null,
  elixir: null,
  csharp: null,
  other: null,
} as const;

const PACKAGE_MANAGER_CRITERIA = {
  npm: null,
  pnpm: null,
  yarn: null,
  bun: null,
  pip: null,
  poetry: null,
  uv: null,
  bundler: null,
  composer: null,
  cargo: null,
  gomod: 'Go modules',
  gradle: null,
  maven: null,
  spm: 'Swift Package Manager',
  cocoapods: null,
  mix: null,
  other: null,
} as const;

const USE_CASE_CRITERIA = {
  saas: 'Software-as-a-service product with user accounts',
  ecommerce: 'Online store or checkout-centric product',
  marketing_site: 'Marketing or landing site',
  docs_site: 'Documentation or content site',
  internal_tool: 'Internal dashboard or back-office tool',
  ai_app: 'AI-first product (chat, agents, generation)',
  api_service: 'Headless API or backend service',
  mobile_app: 'Consumer or business mobile application',
  library_or_cli: 'Library, SDK, or developer CLI',
  other: null,
} as const;

const INDUSTRY_CRITERIA = {
  developer_tools: null,
  fintech: null,
  healthcare: null,
  commerce_retail: null,
  media_entertainment: null,
  education: null,
  productivity: null,
  social: null,
  logistics: null,
  other_unclear: null,
} as const;

/** The full fan-out sent with every detection call. */
export const JEV_QUESTIONS = {
  framework: choice(
    'Which framework or platform should the PostHog wizard integrate FIRST? Judge from the manifests and file tree. If several apps exist, pick the primary user-facing application. Prefer the most specific framework; use a language fallback only when no framework matches.',
    FRAMEWORK_CRITERIA,
  ),
  language: choice(
    'Primary implementation language of this project',
    LANGUAGE_CRITERIA,
  ),
  package_manager: choice(
    'Package manager this project is installed with, judged from lockfiles and manifests',
    PACKAGE_MANAGER_CRITERIA,
  ),
  use_case: choice('What kind of product is this codebase?', USE_CASE_CRITERIA),
  industry: choice('What industry does this product serve?', INDUSTRY_CRITERIA),
  is_monorepo: noul(
    'This repository contains multiple independently deployable apps or packages',
  ),
  typescript: noul('The project is written in TypeScript'),
  has_posthog: noul('A PostHog SDK is already a dependency of this project'),
  has_stripe: noul('Stripe or another billing SDK is a dependency'),
  uses_llm: noul('The project calls LLM APIs (OpenAI, Anthropic, etc.)'),
  has_auth: noul('The application has user authentication'),
  web_frontend: noul('There is a browser-rendered web frontend'),
  is_mobile: noul('The primary deliverable is a mobile app'),
  logs_structured: noul(
    'The project uses a structured logging library (e.g. winston, pino, structlog, loguru, monolog, zap, slog, tracing)',
  ),
  logs_otel: noul(
    'The project uses OpenTelemetry or an OTLP exporter (@opentelemetry/*, opentelemetry-sdk, otel collector config)',
  ),

  // Sub-framework variants — speculative (fan-out is free); code reads only
  // the one matching the framework choice. Mirrors gatherContext/setup
  // disambiguation in the framework configs.
  nextjs_router: choice('If this is a Next.js project, which router?', {
    app_router: 'app/ directory with layout.tsx and page.tsx files',
    pages_router: 'pages/ directory with _app and per-page files',
    mixed: 'Both app/ and pages/ routers are present',
  }),
  react_native_flavor: choice(
    'If this is a React Native project, which flavor?',
    {
      expo: 'An "expo" dependency or app.json with an expo section',
      bare: 'react-native without Expo',
    },
  ),
  astro_rendering: choice(
    'If this is an Astro project, which rendering mode?',
    {
      static: 'Fully prerendered, no SSR adapter',
      server: 'output "server" or an SSR adapter renders every route',
      hybrid: 'Mostly static with some server-rendered routes',
    },
  ),
  tanstack_router_mode: choice(
    'If this project uses TanStack Router, how are routes defined?',
    {
      file_based:
        'A routes/ directory of route files and a generated routeTree.gen.ts appear in the file tree',
      code_based:
        'NO routeTree.gen.ts and NO routes/ directory anywhere in the file tree — routes are built with createRoute() calls inside ordinary source files',
    },
  ),
  laravel_stack: choice('If this is a Laravel project, which frontend stack?', {
    standard: 'Blade views only',
    inertia: 'Inertia.js with a JS frontend framework',
    livewire: 'Livewire components',
  }),
};

/** The variant question relevant to each framework, keyed by Integration. */
export const VARIANT_BY_INTEGRATION = {
  [Integration.nextjs]: 'nextjs_router',
  [Integration.reactNative]: 'react_native_flavor',
  [Integration.astro]: 'astro_rendering',
  [Integration.tanstackRouter]: 'tanstack_router_mode',
  [Integration.tanstackStart]: 'tanstack_router_mode',
  [Integration.laravel]: 'laravel_stack',
} as const satisfies Partial<Record<Integration, keyof typeof JEV_QUESTIONS>>;

export type VariantKey =
  (typeof VARIANT_BY_INTEGRATION)[keyof typeof VARIANT_BY_INTEGRATION];

/** The variant question key for a detected integration, if it has one. */
export function variantKeyFor(
  integration: Integration | null,
): VariantKey | undefined {
  if (integration === null) return undefined;
  return (VARIANT_BY_INTEGRATION as Partial<Record<Integration, VariantKey>>)[
    integration
  ];
}

// ── Generated source questions (warehouse + AI observability) ────────
// One noul per warehouse-source kind, derived from the registry's own
// dep/env footprints — product knowledge stays in the registry.

export const WAREHOUSE_NOUL_PREFIX = 'wh_';
export const AI_NOUL_PREFIX = 'ai_';

function sourceNoul(detector: SourceDetector): NoulQuestion {
  const deps = [
    ...(detector.signals.npm ?? []),
    ...(detector.signals.python ?? []),
    ...(detector.signals.ruby ?? []),
  ].slice(0, 5);
  const envs = (detector.signals.envKeys ?? [])
    .slice(0, 2)
    .map((re) => re.source.replace(/[\^$\\]/g, '').replace(/\(.*\)/, '*'));
  const hints = [
    deps.length > 0 ? `dependencies like ${deps.join(', ')}` : '',
    envs.length > 0 ? `env keys like ${envs.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ');
  return noul(
    `The project uses ${detector.label}${hints ? ` (${hints})` : ''}`,
  );
}

function buildSourceQuestions(kinds: ReadonlySet<string>, prefix: string) {
  const questions: Record<string, NoulQuestion> = {};
  const kindList: string[] = [];
  for (const detector of SOURCE_DETECTORS) {
    if (!kinds.has(detector.kind)) continue;
    if (`${prefix}${detector.kind}` in questions) continue;
    questions[`${prefix}${detector.kind}`] = sourceNoul(detector);
    kindList.push(detector.kind);
  }
  return { questions, kindList };
}

const warehouse = buildSourceQuestions(
  CORE_SOURCE_KINDS,
  WAREHOUSE_NOUL_PREFIX,
);
const ai = buildSourceQuestions(AI_SOURCE_KINDS, AI_NOUL_PREFIX);

/** Warehouse-source kinds asked about, in registry order. */
export const WAREHOUSE_KINDS: readonly string[] = warehouse.kindList;
/** AI/LLM source kinds asked about, in registry order. */
export const AI_KINDS: readonly string[] = ai.kindList;

/** Generated noul questions, merged into the systemOne call alongside JEV_QUESTIONS. */
export const SOURCE_QUESTIONS: Record<string, NoulQuestion> = {
  ...warehouse.questions,
  ...ai.questions,
};

// ── Presence questions (multi-label, independent of the primary Choice) ──
// The Choice picks ONE primary target; these nouls answer "is X present
// anywhere in the repo" independently, so a monorepo is just several yeses
// and "no" is every question's natural default.

export const FRAMEWORK_PRESENCE_PREFIX = 'fw_';
export const LANGUAGE_PRESENCE_PREFIX = 'lang_';

/** Languages asked about for presence (the language Choice minus 'other'). */
export const PRESENCE_LANGUAGES: readonly string[] = [
  'typescript',
  'javascript',
  'python',
  'ruby',
  'php',
  'go',
  'rust',
  'java',
  'kotlin',
  'swift',
  'dart',
  'elixir',
  'csharp',
];

function buildPresenceQuestions(): Record<string, NoulQuestion> {
  const questions: Record<string, NoulQuestion> = {};
  for (const integration of Object.values(Integration)) {
    questions[`${FRAMEWORK_PRESENCE_PREFIX}${integration}`] = noul(
      `Somewhere in this repository there is a project matching: ${FRAMEWORK_CRITERIA[integration]}. It does not need to be the primary app.`,
    );
  }
  for (const language of PRESENCE_LANGUAGES) {
    questions[`${LANGUAGE_PRESENCE_PREFIX}${language}`] = noul(
      `Somewhere in this repository there is ${language} source code or a ${language} project`,
    );
  }
  return questions;
}

/** Presence nouls for every Integration and language, merged into the call. */
export const PRESENCE_QUESTIONS: Record<string, NoulQuestion> =
  buildPresenceQuestions();

const INTEGRATION_BY_VALUE = new Map<string, Integration>(
  Object.values(Integration).map((value) => [value, value as Integration]),
);

/** Map a framework choice label back to an Integration; null for "none" or anything unrecognized. */
export function integrationFromChoice(label: string): Integration | null {
  return INTEGRATION_BY_VALUE.get(label) ?? null;
}
