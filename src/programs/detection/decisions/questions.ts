/** The Decisions API question catalog: framework identity plus every onboarding dimension. */

import { Integration } from '@shared/constants';
import {
  SOURCE_DETECTORS,
  AI_SOURCE_KINDS,
  CORE_SOURCE_KINDS,
} from '../../warehouse-sources/registry';
import type { SourceDetector } from '../../warehouse-sources/types';
import type {
  ChoiceQuestion,
  DecisionQuestion,
  PredicateQuestion,
} from './client';

/** Choice value meaning "no supported framework or language detected". */
export const NO_FRAMEWORK = 'none';

type Criteria = Readonly<Record<string, string | null>>;

function choice(
  name: string,
  instructions: string,
  criteria: Criteria,
): ChoiceQuestion {
  return {
    type: 'choice',
    name,
    instructions,
    choices: Object.entries(criteria).map(([value, description]) =>
      description ? { value, description } : { value },
    ),
  };
}

function predicate(name: string, instructions: string): PredicateQuestion {
  return { type: 'predicate', name, instructions };
}

/** One discriminating description per Integration; a unit test keeps it in sync with the enum. */
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

/** Languages asked about, both as the primary-language choice and for presence. */
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

const LANGUAGE_CRITERIA: Criteria = {
  ...Object.fromEntries(PRESENCE_LANGUAGES.map((language) => [language, null])),
  other: null,
};

const PACKAGE_MANAGER_CRITERIA: Criteria = {
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
};

const USE_CASE_CRITERIA: Criteria = {
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
};

const INDUSTRY_CRITERIA: Criteria = {
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
};

/** Primary choice questions, keyed by report field. */
export const CORE_CHOICES = {
  framework: choice(
    'framework',
    'Which framework or platform should the PostHog wizard integrate FIRST? Judge from the manifests and file tree. If several apps exist, pick the primary user-facing application. Prefer the most specific framework; use a language fallback only when no framework matches.',
    FRAMEWORK_CRITERIA,
  ),
  language: choice(
    'language',
    'Primary implementation language of this project',
    LANGUAGE_CRITERIA,
  ),
  packageManager: choice(
    'package_manager',
    'Package manager this project is installed with, judged from lockfiles and manifests',
    PACKAGE_MANAGER_CRITERIA,
  ),
  useCase: choice(
    'use_case',
    'What kind of product is this codebase?',
    USE_CASE_CRITERIA,
  ),
  industry: choice(
    'industry',
    'What industry does this product serve?',
    INDUSTRY_CRITERIA,
  ),
} as const;

export type CoreChoiceKey = keyof typeof CORE_CHOICES;

/** Yes/no project signals, keyed by report field. */
export const SIGNAL_QUESTIONS = {
  isMonorepo: predicate(
    'is_monorepo',
    'This repository contains multiple independently deployable apps or packages',
  ),
  typescript: predicate('typescript', 'The project is written in TypeScript'),
  hasPosthog: predicate(
    'has_posthog',
    'A PostHog SDK is already a dependency of this project',
  ),
  hasStripe: predicate(
    'has_stripe',
    'Stripe or another billing SDK is a dependency',
  ),
  usesLlm: predicate(
    'uses_llm',
    'The project calls LLM APIs (OpenAI, Anthropic, etc.)',
  ),
  hasAuth: predicate('has_auth', 'The application has user authentication'),
  webFrontend: predicate(
    'web_frontend',
    'There is a browser-rendered web frontend',
  ),
  isMobile: predicate('is_mobile', 'The primary deliverable is a mobile app'),
  structuredLogs: predicate(
    'logs_structured',
    'The project uses a structured logging library (e.g. winston, pino, structlog, loguru, monolog, zap, slog, tracing)',
  ),
  openTelemetry: predicate(
    'logs_otel',
    'The project uses OpenTelemetry or an OTLP exporter (@opentelemetry/*, opentelemetry-sdk, otel collector config)',
  ),
} as const;

export type SignalKey = keyof typeof SIGNAL_QUESTIONS;

/** Sub-framework variants, asked speculatively; code reads only the one matching the framework. */
export const VARIANT_QUESTIONS = {
  nextjs_router: choice(
    'nextjs_router',
    'If this is a Next.js project, which router?',
    {
      app_router: 'app/ directory with layout.tsx and page.tsx files',
      pages_router: 'pages/ directory with _app and per-page files',
      mixed: 'Both app/ and pages/ routers are present',
    },
  ),
  react_native_flavor: choice(
    'react_native_flavor',
    'If this is a React Native project, which flavor?',
    {
      expo: 'An "expo" dependency or app.json with an expo section',
      bare: 'react-native without Expo',
    },
  ),
  astro_rendering: choice(
    'astro_rendering',
    'If this is an Astro project, which rendering mode?',
    {
      static: 'Fully prerendered, no SSR adapter',
      server: 'output "server" or an SSR adapter renders every route',
      hybrid: 'Mostly static with some server-rendered routes',
    },
  ),
  tanstack_router_mode: choice(
    'tanstack_router_mode',
    'If this project uses TanStack Router, how are routes defined?',
    {
      file_based:
        'A routes/ directory of route files and a generated routeTree.gen.ts appear in the file tree',
      code_based:
        'NO routeTree.gen.ts and NO routes/ directory anywhere in the file tree — routes are built with createRoute() calls inside ordinary source files',
    },
  ),
  laravel_stack: choice(
    'laravel_stack',
    'If this is a Laravel project, which frontend stack?',
    {
      standard: 'Blade views only',
      inertia: 'Inertia.js with a JS frontend framework',
      livewire: 'Livewire components',
    },
  ),
} as const;

export type VariantKey = keyof typeof VARIANT_QUESTIONS;

/** The variant question relevant to each framework. */
export const VARIANT_BY_INTEGRATION: Partial<Record<Integration, VariantKey>> =
  {
    [Integration.nextjs]: 'nextjs_router',
    [Integration.reactNative]: 'react_native_flavor',
    [Integration.astro]: 'astro_rendering',
    [Integration.tanstackRouter]: 'tanstack_router_mode',
    [Integration.tanstackStart]: 'tanstack_router_mode',
    [Integration.laravel]: 'laravel_stack',
  };

export function variantKeyFor(
  integration: Integration | null,
): VariantKey | undefined {
  return integration === null ? undefined : VARIANT_BY_INTEGRATION[integration];
}

export const WAREHOUSE_PREFIX = 'wh_';
export const AI_PREFIX = 'ai_';
export const FRAMEWORK_PRESENCE_PREFIX = 'fw_';
export const LANGUAGE_PRESENCE_PREFIX = 'lang_';

/** A predicate per source kind, phrased from the registry's own dep/env footprint. */
function sourcePredicate(prefix: string, detector: SourceDetector) {
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
  return predicate(
    `${prefix}${detector.kind}`,
    `The project uses ${detector.label}${hints ? ` (${hints})` : ''}`,
  );
}

function sourceQuestions(kinds: ReadonlySet<string>, prefix: string) {
  const questions: PredicateQuestion[] = [];
  const seen = new Set<string>();
  for (const detector of SOURCE_DETECTORS) {
    if (!kinds.has(detector.kind) || seen.has(detector.kind)) continue;
    seen.add(detector.kind);
    questions.push(sourcePredicate(prefix, detector));
  }
  return { questions, kinds: [...seen] };
}

const warehouse = sourceQuestions(CORE_SOURCE_KINDS, WAREHOUSE_PREFIX);
const ai = sourceQuestions(AI_SOURCE_KINDS, AI_PREFIX);

/** Warehouse-source kinds asked about, in registry order. */
export const WAREHOUSE_KINDS: readonly string[] = warehouse.kinds;
/** AI/LLM source kinds asked about, in registry order. */
export const AI_KINDS: readonly string[] = ai.kinds;

/** Multi-label presence: "is X anywhere in the repo", independent of the primary choice. */
export const PRESENCE_QUESTIONS: readonly PredicateQuestion[] = [
  ...Object.values(Integration).map((integration) =>
    predicate(
      `${FRAMEWORK_PRESENCE_PREFIX}${integration}`,
      `Somewhere in this repository there is a project matching: ${FRAMEWORK_CRITERIA[integration]}. It does not need to be the primary app.`,
    ),
  ),
  ...PRESENCE_LANGUAGES.map((language) =>
    predicate(
      `${LANGUAGE_PRESENCE_PREFIX}${language}`,
      `Somewhere in this repository there is ${language} source code or a ${language} project`,
    ),
  ),
];

/** Every question, framework first so it always lands in the first batch. */
export const DECISION_QUESTIONS: readonly DecisionQuestion[] = [
  ...Object.values(CORE_CHOICES),
  ...Object.values(SIGNAL_QUESTIONS),
  ...Object.values(VARIANT_QUESTIONS),
  ...warehouse.questions,
  ...ai.questions,
  ...PRESENCE_QUESTIONS,
];

const INTEGRATION_BY_VALUE = new Map<string, Integration>(
  Object.values(Integration).map((value) => [value, value]),
);

/** Map a framework choice back to an Integration; null for "none" or anything unrecognized. */
export function integrationFromChoice(value: string): Integration | null {
  return INTEGRATION_BY_VALUE.get(value) ?? null;
}
