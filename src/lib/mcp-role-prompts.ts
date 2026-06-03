/**
 * Role + framework-tailored MCP prompt suggestions.
 *
 * The wizard surfaces these on the McpSuggestedPromptsScreen after MCP install.
 * Picking strategy:
 *   1. If we know the user's role AND framework family, return the bespoke kit.
 *   2. If we only know the role, return the role's default kit.
 *   3. If we only know the framework, return the framework's role-agnostic kit.
 *   4. Otherwise return DEFAULT_KIT.
 *
 * Kit shape: an ordered list of { prompt, description } — first prompt is the
 * "test prompt" we ask the user to copy as the verify-and-celebrate trigger.
 */

import type { Integration } from './constants';

/**
 * Roles that ship from `role_at_organization` on the PostHog user object.
 * `security` isn't in the enum upstream — the engineering kit covers that audience.
 */
export const TAILORED_ROLES = [
  'founder',
  'product',
  'leadership',
  'marketing',
  'engineering',
  'data',
] as const;

export type TailoredRole = (typeof TAILORED_ROLES)[number];

export interface SuggestedPrompt {
  /** The prompt the user copies and pastes into their agent. */
  prompt: string;
  /** One-line description shown beside the prompt — what it accomplishes. */
  description: string;
}

export type PromptKit = SuggestedPrompt[];

function isTailoredRole(role: string | null | undefined): role is TailoredRole {
  return (
    typeof role === 'string' &&
    (TAILORED_ROLES as readonly string[]).includes(role)
  );
}

/**
 * Buckets `Integration` values into broader framework families so we can
 * write one kit per family instead of per individual integration.
 */
export type FrameworkFamily =
  | 'frontend-web'
  | 'mobile'
  | 'backend'
  | 'fullstack'
  | 'unknown';

const INTEGRATION_FAMILY: Record<string, FrameworkFamily> = {
  nextjs: 'fullstack',
  nuxt: 'fullstack',
  'tanstack-start': 'fullstack',
  astro: 'fullstack',
  sveltekit: 'fullstack',
  vue: 'frontend-web',
  angular: 'frontend-web',
  'react-router': 'frontend-web',
  'tanstack-router': 'frontend-web',
  javascript_web: 'frontend-web',
  'react-native': 'mobile',
  swift: 'mobile',
  android: 'mobile',
  django: 'backend',
  flask: 'backend',
  fastapi: 'backend',
  python: 'backend',
  laravel: 'backend',
  rails: 'backend',
  ruby: 'backend',
  javascript_node: 'backend',
};

export function getFrameworkFamily(
  integration: Integration | null | undefined,
): FrameworkFamily {
  if (!integration) return 'unknown';
  return INTEGRATION_FAMILY[integration] ?? 'unknown';
}

// ── Default first-pick prompt ──────────────────────────────────────────
// Every role kit starts with this prompt. Pre-Phase-6 it was load-bearing
// as the "verify" trigger (its write to activity_log was what the screen
// polled for). Post-Phase-6 it's just a good first-pick: a write-shaped
// prompt creates a visible, dated artifact in the user's project that
// makes the MCP integration feel real on the first run. The annotation
// is dated, visible on every chart, and reversible from the PostHog UI
// in seconds — so a low-risk demo.
//
// The constant name (VERIFY_PROMPT) is kept for compatibility with any
// future code that might still want a "default first prompt" handle,
// but the screen no longer special-cases it.
export const VERIFY_PROMPT: SuggestedPrompt = {
  prompt: "Annotate today with 'PostHog wizard install'",
  description:
    'Creates a dated note on your project — visible on every chart. Delete anytime from PostHog.',
};

// ── Suggested prompts (generic, role-agnostic) ─────────────────────────
// What McpSuggestedPromptsScreen actually shows today. Picked so each
// prompt is more or less guaranteed to return data on any active
// PostHog project (no assumption that specific events like "signup" or
// "$pageview" exist, no assumption about org plan or feature access).
//
// The role-tailored kits below this constant are intentionally kept for
// future use — when we re-introduce role-aware prompts, the screen
// imports `getRolePrompts` instead of this list. For now the screen
// reads this directly.
export const STOCK_MCP_SUGGESTED_PROMPTS: PromptKit = [
  {
    prompt: 'What events am I currently tracking and when did each last fire?',
    description:
      'Inventories your project’s event stream so you can see what’s being captured at a glance.',
  },
  {
    prompt: 'Show me daily event volume for the last 30 days.',
    description:
      'Charts your event count day by day — a quick read on volume and trend.',
  },
  {
    prompt:
      'Create a dashboard with my top 10 events broken down by day for the last 7 days.',
    description:
      'Builds a saved dashboard you can pin and share — written back to your project.',
  },
];

// ── Default kit (no role, no framework) ────────────────────────────────
const DEFAULT_KIT: PromptKit = [
  VERIFY_PROMPT,
  {
    prompt: 'Show me my top 10 events from the last 7 days',
    description: 'Get a feel for what your project is tracking.',
  },
  {
    prompt: 'Build me a funnel for my main user journey',
    description: 'Insight discovery — your agent picks the events.',
  },
  {
    prompt: 'Create a feature flag called new-feature rolled out to 10%',
    description: 'Flag CRUD — instant kill switch for your next release.',
  },
  {
    prompt: 'Alert me if my error rate spikes above baseline',
    description: 'Set up a sensible default alert without leaving your IDE.',
  },
];

// ── Role-only kits (used when framework family is unknown) ─────────────

const ROLE_KITS: Record<TailoredRole, PromptKit> = {
  founder: [
    VERIFY_PROMPT,
    {
      prompt: 'Build me an exec dashboard: MRR, MAU, churn, top events',
      description: 'A one-glance view of the business you can pin and share.',
    },
    {
      prompt: 'Show me weekly active users for the last 90 days',
      description: 'The trendline you actually care about.',
    },
    {
      prompt: 'Alert me if MAU drops more than 10% week-over-week',
      description: 'Wake-up call if growth stalls — set and forget.',
    },
    {
      prompt: 'Run an NPS survey on all paid customers',
      description: 'Pulse-check on the people paying you.',
    },
  ],
  product: [
    VERIFY_PROMPT,
    {
      prompt: 'Build a funnel for my onboarding flow',
      description: 'See where new users drop off in their first session.',
    },
    {
      prompt:
        'Create a feature flag for the new pricing page rolled out to 25%',
      description: 'Ship safely — flag CRUD straight from your agent.',
    },
    {
      prompt: 'A/B test the redesigned upgrade CTA',
      description: 'Spin up an experiment without leaving your IDE.',
    },
    {
      prompt: 'Compute week-1 retention split by acquisition channel',
      description: 'Find the channel that actually retains users.',
    },
  ],
  leadership: [
    VERIFY_PROMPT,
    {
      prompt: 'Build a board dashboard: revenue, MAU, churn, support backlog',
      description: 'Pre-board prep in one prompt.',
    },
    {
      prompt: 'Show MAU growth over the last 4 quarters',
      description: 'The chart for the next leadership slide.',
    },
    {
      prompt: 'Alert the leadership channel when churn doubles week-over-week',
      description: 'Slack ping when something needs your attention.',
    },
    {
      prompt: 'Which features drive the most upgrades?',
      description: 'Ranked breakdown of what actually moves the needle.',
    },
  ],
  marketing: [
    VERIFY_PROMPT,
    {
      prompt: "Cohort of users who saw pricing but didn't sign up",
      description: 'Retargetable list of high-intent visitors.',
    },
    {
      prompt: 'A/B test the landing page hero copy',
      description: 'Run the experiment, get the verdict, no engineering ask.',
    },
    {
      prompt: 'Send an NPS survey to users who clicked our last newsletter',
      description: 'Closed-loop feedback on the campaign that just ran.',
    },
    {
      prompt: 'Annotate today as the launch of the new landing page',
      description: 'Pin the deploy on every chart so future you can find it.',
    },
  ],
  engineering: [
    VERIFY_PROMPT,
    {
      prompt: "List flags rolled out to 100% — they're probably safe to delete",
      description: 'Dead-code hunt for your feature flag config.',
    },
    {
      prompt: 'Show me the top 10 unresolved errors this week',
      description: 'Triage queue without opening another tab.',
    },
    {
      prompt: 'Page me if 5xx error rate exceeds 1% over 5 minutes',
      description: 'Alerting that catches real incidents.',
    },
    {
      prompt: 'Add a kill-switch flag for the next release rolled out to 0%',
      description: 'Ship safer — one prompt sets up the rollback.',
    },
  ],
  data: [
    VERIFY_PROMPT,
    {
      prompt: 'Top 20 events by volume in the last 24 hours',
      description: 'Smoke test for ingestion + a sanity check on volumes.',
    },
    {
      prompt: 'Retention curve for paid users by signup month',
      description: "The cohort chart you'd build first anyway.",
    },
    {
      prompt: 'Funnel: signup → activated → first power feature → paid',
      description: 'Drop-off across the full journey, ready to slice.',
    },
    {
      prompt:
        'Cohort of power users — 5+ sessions per week over the last month',
      description: 'High-value segment, materialized in seconds.',
    },
  ],
};

// ── Role × framework family overrides (specific replacements) ──────────
// Only override individual prompts where the framework changes the answer.
// Anything not listed inherits from the role kit above.

interface PromptOverrides {
  /** Override the prompt at this index (0-based) within the role's kit. */
  [index: number]: SuggestedPrompt;
}

type FamilyOverrides = Partial<Record<FrameworkFamily, PromptOverrides>>;

const ROLE_FAMILY_OVERRIDES: Partial<Record<TailoredRole, FamilyOverrides>> = {
  product: {
    'frontend-web': {
      3: {
        prompt:
          'A/B test the redesigned upgrade CTA — variants control / red / green',
        description: 'Frontend experiment with three arms, wired to your flag.',
      },
    },
    mobile: {
      1: {
        prompt:
          'Funnel: app_open → onboarding_complete → first_session_complete',
        description:
          'Mobile-flavored onboarding funnel with sensible defaults.',
      },
      3: {
        prompt:
          'Create a feature flag gated on app version >= the current release',
        description:
          'Version-gated rollouts — only new clients see the change.',
      },
    },
    backend: {
      1: {
        prompt: 'Funnel of signup → first API call → paid for last 30 days',
        description:
          'Backend funnel that reflects what your service actually sees.',
      },
    },
  },
  engineering: {
    'frontend-web': {
      2: {
        prompt:
          'Top 10 JS errors by occurrence count this week, with affected URLs',
        description: 'Frontend-specific error triage — sorted by blast radius.',
      },
    },
    mobile: {
      2: {
        prompt:
          'Top crashes this week by app version, sorted by affected users',
        description:
          'Mobile crash triage straight from the same data PostHog has.',
      },
      3: {
        prompt: 'Page me when crash-free sessions drop below 99%',
        description:
          'Crash-free SLA alert — the one mobile metric that matters.',
      },
    },
    backend: {
      2: {
        prompt: 'Top 10 server-side errors this week, grouped by endpoint',
        description: 'Backend error triage by route, sorted by frequency.',
      },
      3: {
        prompt:
          'Alert when p95 response time exceeds 500ms over a 5-minute window',
        description: 'Latency SLO alert against the data you already collect.',
      },
    },
  },
  data: {
    backend: {
      3: {
        prompt:
          'Funnel: api_signup → first_api_call → first_paid_event over last 30 days',
        description:
          'Backend conversion funnel — captures the value your service delivers.',
      },
    },
  },
};

/**
 * Resolve the right kit given everything we know about the user + project.
 * Always returns at least DEFAULT_KIT; never throws.
 */
export function getRolePrompts(
  role: string | null | undefined,
  integration: Integration | null | undefined,
): PromptKit {
  const family = getFrameworkFamily(integration);

  if (!isTailoredRole(role)) {
    // Unknown role — DEFAULT_KIT is already framework-agnostic and broad.
    return DEFAULT_KIT;
  }

  const baseKit = ROLE_KITS[role];
  const overridesForRole = ROLE_FAMILY_OVERRIDES[role];
  const overridesForFamily = overridesForRole?.[family];

  if (!overridesForFamily) {
    return baseKit;
  }

  return baseKit.map((prompt, idx) => overridesForFamily[idx] ?? prompt);
}

/**
 * Public-facing label for a role — used to acknowledge the user when the
 * kit is rendered (e.g. "Picked for a product manager:").
 */
const ROLE_LABEL: Record<TailoredRole, string> = {
  founder: 'a founder',
  product: 'a product manager',
  leadership: 'leadership',
  marketing: 'marketing',
  engineering: 'engineering',
  data: 'a data analyst',
};

export function getRoleLabel(role: string | null | undefined): string | null {
  if (!isTailoredRole(role)) return null;
  return ROLE_LABEL[role];
}
