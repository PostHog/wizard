/**
 * Every question the wizard asks the Decisions API, and the fact each answer
 * gives the agents. Edit wording here. Programs pick theirs from `QUESTIONS`
 * by key in `ProgramConfig.decisions`; each key is the question's name.
 *
 * Facts reach agents only in primary mode, and only for a confident answer:
 * `likely` at or above 0.6, `unlikely` at or below 0.1, a choice at or above
 * 0.6 unless it is `other` or `none`.
 */

import { choice, defineQuestions, predicate } from './builders';
import { FRAMEWORK_CHOICES } from './framework';
import type { DecisionQuestionSpec } from './types';
import type { DecisionQuestionKey } from '../../program-contract/program-step';

export const QUESTIONS = defineQuestions({
  // ── What the project is ──────────────────────────────────────────

  // Asked by: posthog-integration, replay-vision
  framework: choice({
    ask: 'Which framework or platform should the PostHog wizard integrate first? Judge from the dependencies and file tree. If several apps exist, pick the primary user-facing application. Prefer the most specific framework; use a language fallback only when no framework matches.',
    choices: FRAMEWORK_CHOICES,
    purpose: 'Confirm which framework integration to set up.',
  }),

  // Asked by: posthog-integration
  is_monorepo: predicate({
    ask: 'This repository holds several independently deployable apps or packages.',
    purpose: 'Decide whether to offer a choice of app.',
  }),

  // Asked by: posthog-integration
  product_category: choice({
    ask: 'Which kind of product does this code build? Judge from its routes, dependencies and file names.',
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
    fact: 'Product category: {choice}. Shape the event plan around it.',
  }),

  // Asked by: error-tracking, replay-vision
  web_frontend: predicate({
    ask: 'There is a browser-rendered web frontend: pages or components that run in a browser.',
    purpose:
      'Decide whether browser-side setup applies: session replay, browser error capture.',
    facts: {
      unlikely:
        'The project shows no browser frontend: browser-side setup such as session replay has nothing to run in.',
    },
  }),

  // Asked by: error-tracking, posthog-integration
  server_runtime: predicate({
    ask: 'There is a server runtime that handles requests or jobs: an API, a web server, workers or serverless functions.',
    purpose: 'Decide whether server-side setup applies: server error capture.',
    facts: {
      likely:
        'The project has a server runtime: capture server-side exceptions too, not just browser ones.',
    },
  }),

  // Asked by: self-driving, replay-vision
  primary_user_flow: choice({
    ask: 'Which user flow looks most central to this product? Judge from its routes, pages and file names.',
    choices: {
      signup_onboarding: 'Sign-up and onboarding',
      checkout_purchase: 'Checkout or purchase',
      search_browse: 'Search or browsing a catalog',
      content_consumption: 'Reading or watching content',
      creation_editing: 'Creating or editing things',
      dashboard_reporting: 'Dashboards and reporting',
      collaboration: 'Collaboration or messaging',
      other: null,
    },
    purpose:
      'Scope the first scanners and insights to the flow that matters most.',
    fact: "The product's central flow looks like {choice}: start with it.",
  }),

  // Asked by: self-driving
  user_login: predicate({
    ask: 'The app has a sign-in flow, so events can be tied to a signed-in user.',
    purpose: 'Decide whether to identify users at sign-in.',
    facts: {
      likely: 'The app has a sign-in flow: identify users when they sign in.',
    },
  }),

  // ── Which tasks apply ────────────────────────────────────────────

  // Asked by: posthog-integration, ai-observability
  calls_llm_api: predicate({
    ask: 'App code calls an LLM API (OpenAI, Anthropic, Gemini, …), with or without an SDK.',
    purpose: 'Decide whether AI Observability applies.',
    facts: {
      likely:
        'App code appears to call an LLM API: AI Observability likely applies.',
      unlikely:
        'App code shows no LLM API calls: AI Observability likely does not apply. Confirm before skipping it, and say why in the setup report.',
    },
  }),

  // Asked by: posthog-integration
  structured_logging: predicate({
    ask: 'The project uses a structured logging library, such as winston, pino, structlog, loguru, monolog, zap, slog or tracing.',
    purpose: 'Decide whether Logs applies.',
    facts: {
      likely:
        'The project uses a structured logging library: Logs likely applies.',
      unlikely: 'The project shows no structured logging library.',
    },
  }),

  // Asked by: posthog-integration
  otel_exporter: predicate({
    ask: 'The project uses OpenTelemetry or an OTLP exporter (@opentelemetry/*, opentelemetry-sdk, an otel collector config).',
    purpose: 'Decide whether Logs can use the OTLP path.',
    facts: {
      likely:
        'The project already uses OpenTelemetry: prefer the OTLP path for Logs.',
      unlikely: 'The project shows no OpenTelemetry setup.',
    },
  }),

  // Asked by: posthog-integration
  // Overlaps the tool catalog: packages like dd-trace or newrelic are lookups.
  // This also reads agent config files and env key names the catalog doesn't match.
  observability_stack: choice({
    ask: "Which observability tool already receives this backend's logs or traces? Judge from packages such as dd-trace or newrelic, files such as datadog.yaml or newrelic.js, and env key names such as DD_API_KEY.",
    choices: {
      datadog: 'Datadog',
      new_relic: 'New Relic',
      sentry: 'Sentry',
      splunk: 'Splunk',
      grafana: 'Grafana, Loki or Tempo',
      honeycomb: 'Honeycomb',
      elastic: 'Elastic or Logstash',
      otel_collector: 'OpenTelemetry to a self-hosted collector',
      none: 'None',
      other: null,
    },
    purpose:
      'Learn what the backend already uses for logs or traces, before setting up Logs.',
    fact: 'The backend already sends logs or traces to {choice}: add PostHog Logs alongside it, and leave the existing setup in place.',
  }),

  // ── Source maps ──────────────────────────────────────────────────

  // Asked by: error-tracking-upload-source-maps
  ships_minified_js: predicate({
    ask: 'The project ships bundled or minified JavaScript to browsers or devices, so its stack traces need source maps.',
    purpose: 'Decide whether source-map upload applies.',
    facts: {
      unlikely:
        'The project shows no bundled or minified JavaScript: source maps may not be needed. Confirm before setting up uploads.',
    },
  }),

  // Asked by: error-tracking-upload-source-maps
  build_tool: choice({
    ask: 'Which tool builds the JavaScript that ships to users? When a framework owns the build, answer the framework.',
    choices: {
      nextjs: 'Next.js build',
      nuxt: 'Nuxt build',
      angular: 'Angular CLI',
      vite: 'Vite',
      webpack: 'Webpack',
      rollup: 'Rollup',
      react_native: 'React Native or Expo (Metro)',
      none: 'No JavaScript build',
      other: null,
    },
    purpose: 'Confirm which source-map upload variant fits the build.',
    fact: 'The shipped JavaScript is built with {choice}: upload source maps from that build.',
  }),

  // Asked by: error-tracking-upload-source-maps
  deploy_platform: choice({
    ask: 'Where does this project appear to deploy? Judge from files such as vercel.json, netlify.toml, wrangler.toml, fly.toml, Procfile or a Dockerfile.',
    choices: {
      vercel: 'Vercel',
      netlify: 'Netlify',
      cloudflare: 'Cloudflare',
      fly: 'Fly.io',
      heroku: 'Heroku',
      container: 'A container image (Dockerfile)',
      other: null,
    },
    purpose: 'Find the build step that source-map uploads hook into.',
    fact: 'The project appears to deploy on {choice}: add the source-map upload to that build.',
  }),

  // ── Data warehouse and revenue ───────────────────────────────────

  // Asked by: warehouse-source
  owns_database: predicate({
    ask: 'The app keeps its own database, with ORM models, schema files or migrations (Prisma, Drizzle, TypeORM, SQLAlchemy, Django models, ActiveRecord, Ecto).',
    purpose: "Decide whether to suggest importing the app's own database.",
    facts: {
      likely:
        'The app keeps its own database: suggest importing it, so product events can be joined with business data.',
    },
  }),

  // Asked by: revenue-analytics
  billing_code: predicate({
    ask: 'The app runs billing or checkout code, such as subscriptions, charges or invoices.',
    purpose: 'Decide whether revenue analytics applies.',
    facts: {
      likely: 'The app runs billing code: revenue analytics applies.',
      unlikely:
        'The app shows no billing code: revenue analytics may not apply. Confirm before going further.',
    },
  }),

  // ── MCP analytics ────────────────────────────────────────────────

  // Asked by: mcp-analytics
  is_mcp_server: predicate({
    ask: 'This project implements an MCP (Model Context Protocol) server, with an MCP SDK or its own tool handlers.',
    purpose: 'Decide whether MCP analytics applies.',
    facts: {
      likely:
        'The project implements an MCP server: instrument its tool handlers.',
      unlikely:
        'The project shows no MCP server: MCP analytics may not apply. Confirm before going further.',
    },
  }),
});

/** A question's key in the catalog, which is also its name. Programs declare these in `ProgramConfig.decisions`. */
export type QuestionKey = keyof typeof QUESTIONS;

// Typecheck fails when the program contract's key list and this catalog differ.
type SameKeys<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
type Assert<T extends true> = T;
export type QuestionKeysMatch = Assert<
  SameKeys<QuestionKey, DecisionQuestionKey>
>;

// ── Asked per repository: their choices are the folders found ──────

/** Choice value meaning "this folder is none of the targets, or not an app". */
export const NOT_A_TARGET = 'none';

export function projectTargetName(index: number): string {
  return `project_${index}_target`;
}

/**
 * Asked once per candidate folder: which of the caller's targets it is. Asked
 * by project detection, so by every program with a project picker:
 * error-tracking, self-driving, error-tracking-upload-source-maps, and CI scoping.
 */
export function projectTargetQuestion(
  index: number,
  dir: string,
  targets: ReadonlyArray<{ id: string; name: string }>,
  purpose: string,
): DecisionQuestionSpec {
  return {
    name: projectTargetName(index),
    ...choice({
      ask: `Which of these is the project rooted at \`${dir}\`? Judge from its own dependencies and files. When several match, answer the one listed first. Answer ${NOT_A_TARGET} when it matches none, or when it is a shared library, config or tooling package rather than an app.`,
      choices: {
        ...Object.fromEntries(targets.map((t) => [t.id, t.name])),
        [NOT_A_TARGET]: 'None of these, or not an app',
      },
      purpose: `Find the projects to ${purpose}.`,
    }),
  };
}

export const PRIMARY_APP = 'primary_app';

/** Which candidate folder is the main app. Ask only with two or more folders. Asked by project detection, as above. */
export function primaryAppQuestion(
  dirs: readonly string[],
): DecisionQuestionSpec {
  return {
    name: PRIMARY_APP,
    ...choice({
      ask: 'Which folder holds the main user-facing app of this repository?',
      choices: Object.fromEntries(dirs.map((dir) => [dir, null])),
      purpose: 'Suggest which app to set up first.',
    }),
  };
}
