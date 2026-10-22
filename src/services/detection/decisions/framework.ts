/** Framework identity: the choices the framework question offers, the Integration an answer names, and the gates that let it override static detection. */

import { Integration } from '@shared/constants';
import type { DecisionAnswer } from './types';

/** Choice value meaning "no supported framework or language detected". */
export const NO_FRAMEWORK = 'none';

/** One discriminating description per Integration. */
export const FRAMEWORK_CHOICES: Readonly<Record<string, string>> = {
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

const INTEGRATION_BY_VALUE = new Map<string, Integration>(
  Object.values(Integration).map((value) => [value, value]),
);

/** Map a framework choice back to an Integration; null for "none" or anything unrecognized. */
export function integrationFromChoice(value: string): Integration | null {
  return INTEGRATION_BY_VALUE.get(value) ?? null;
}

/** Accept the answer outright at or above this probability. Starting point; calibrate from shadow runs. */
export const DECISIONS_ACCEPT_PROBABILITY = 0.85;
/** Between the gates, the answer needs static agreement or a static miss. */
export const DECISIONS_AGREE_PROBABILITY = 0.6;

/** Whether a framework answer may decide over `staticResult`, and the Integration it names. */
export function routeIntegration(
  answer: DecisionAnswer | undefined,
  staticResult: Integration | undefined,
): { integration: Integration | undefined; source: 'static' | 'decisions' } {
  const integration =
    answer?.kind === 'choice' ? integrationFromChoice(answer.choice) : null;
  if (!answer || integration === null) {
    return { integration: staticResult, source: 'static' };
  }
  if (answer.probability >= DECISIONS_ACCEPT_PROBABILITY) {
    return { integration, source: 'decisions' };
  }
  if (
    answer.probability >= DECISIONS_AGREE_PROBABILITY &&
    (staticResult === undefined || staticResult === integration)
  ) {
    return { integration, source: 'decisions' };
  }
  return { integration: staticResult, source: 'static' };
}
