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
// Conservative kit kept around for fallback uses (the playground demo
// compares against it, downstream features may want a "neutral" set).
// The production screen calls `getRolePrompts` instead so users with a
// known role + framework get a tailored kit.
export const STOCK_MCP_SUGGESTED_PROMPTS: PromptKit = [
  {
    prompt: 'What are my busiest 10 events and when did each last fire?',
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

// ── Role-tuned greeting copy ───────────────────────────────────────────
// Shown in the Greeting phase between Authenticating and PromptPicker.
// The screen feeds these into a ContentSequencer: headline typewrites,
// bullets reveal line-by-line, outro fades in, then the picker mounts.

export interface RoleGreeting {
  /** 1-line hook — typewrites in. */
  headline: string;
  /** 2-3 lines of value framing — revealed line-by-line. */
  bullets: string[];
  /** Sets up the picker, e.g. "Pick one to try." — fades in. */
  outro: string;
}

const ROLE_GREETINGS: Record<TailoredRole, RoleGreeting> = {
  founder: {
    headline: 'Founders use MCP to keep a hand on growth.',
    bullets: [
      'Weekly active users, retention, and revenue without leaving your IDE.',
      'Alerts when something stalls — set once, forget about it.',
      'Pin annotations on every chart so you remember what shipped.',
    ],
    outro:
      "Pick a prompt below — your agent will run it on your project's real data.",
  },
  product: {
    headline: 'PMs use MCP to ship faster and learn quicker.',
    bullets: [
      'Funnels for every onboarding flow you want to test.',
      'Feature flags and experiments without a deploy.',
      'Retention sliced by acquisition channel in seconds.',
    ],
    outro: 'Pick a prompt below — your agent will do the legwork.',
  },
  leadership: {
    headline: 'Run the business from your terminal.',
    bullets: [
      'Board-ready dashboards in one prompt.',
      'Slack alerts when MAU, churn, or revenue drifts.',
      'The numbers for the next leadership slide, on tap.',
    ],
    outro: 'Pick a prompt below to see PostHog work for you.',
  },
  marketing: {
    headline: 'Marketing campaigns, fully instrumented.',
    bullets: [
      'Cohorts of high-intent visitors, ready to retarget.',
      'A/B test landing copy without an engineering ticket.',
      'Tie every campaign to revenue with annotated launches.',
    ],
    outro: 'Pick a prompt below to try it on your data.',
  },
  engineering: {
    headline: 'MCP is your shortest path from bug to fix.',
    bullets: [
      'Top errors this week, sorted by blast radius.',
      'Latency SLOs and crash-free SLAs with one prompt.',
      'Kill-switch flags ready before the next release.',
    ],
    outro: 'Pick a prompt below — your agent has full read/write access.',
  },
  data: {
    headline: 'Data work without leaving the terminal.',
    bullets: [
      'Cohorts in seconds, materialized in your project.',
      'Retention curves by signup month, sliced any way you want.',
      'Run SQL against your event stream — no copy-paste, no exports.',
    ],
    outro: 'Pick a prompt below — every result is real data from your project.',
  },
};

const NEUTRAL_GREETING: RoleGreeting = {
  headline: 'PostHog MCP turns your agent into a product analyst.',
  bullets: [
    'Run queries, build dashboards, ship flags — straight from your IDE.',
    'Every result is real data from your project.',
    'No copy-pasting tokens, no context switching.',
  ],
  outro: 'Pick a prompt below to see what MCP can do.',
};

export function getRoleGreeting(role: string | null | undefined): RoleGreeting {
  if (!isTailoredRole(role)) return NEUTRAL_GREETING;
  return ROLE_GREETINGS[role];
}

// ── Follow-up dialogue tree ────────────────────────────────────────────
// After a prompt finishes streaming we surface 3 context-aware next
// steps + an exit entry. To avoid feeling stuck on the same three
// suggestions, the candidate pool blends three sources:
//
//   1. Tool-specific pool — keyed by the agent's most recent tool call,
//      tailored to "you just ran X, what's natural after?"
//   2. Role-specific pool — keyed by the user's role, tailored to "your
//      day-to-day with PostHog probably looks like this".
//   3. Generic pool — broad creative prompts that always make sense.
//
// We dedupe against `branchHistory` so the user never sees a suggestion
// for a prompt they already ran, then pick 3 with a rotation offset
// driven by `branchHistory.length`. The rotation means a user who keeps
// hitting the same tool sees a different slice each visit, and a user
// going deep down the tree sees the pool evolve.
//
// The exit follow-up is always appended last so dismissal is
// discoverable without [esc].

export interface FollowUp {
  /** Label shown in the FollowUp PickerMenu. */
  label: string;
  /** Prompt to run on pick. Equal to FOLLOW_UP_EXIT_SENTINEL for the exit entry. */
  prompt: string;
}

export const FOLLOW_UP_EXIT_SENTINEL = '__follow_up_exit__';
/** How many follow-up suggestions to surface above the exit entry. */
export const FOLLOW_UP_COUNT = 3;

const EXIT_FOLLOW_UP: FollowUp = {
  label: "I'm done — exit",
  prompt: FOLLOW_UP_EXIT_SENTINEL,
};

// Tool-name → candidate follow-ups. Pools are intentionally larger than
// FOLLOW_UP_COUNT so successive visits rotate through different
// suggestions. Tool names mirror what the PostHog MCP server emits;
// `normalizeToolName` strips the `mcp__<server>__` prefix at lookup.
const TOOL_FOLLOW_UPS: Record<string, FollowUp[]> = {
  'query-error-tracking-issue': [
    {
      label: 'Dig into the top issue',
      prompt:
        'Show me the stack trace and recent occurrences for the top error.',
    },
    {
      label: 'Set up an alert',
      prompt: 'Page me if that error rate doubles week-over-week.',
    },
    {
      label: 'Find related events',
      prompt: 'What events do users trigger right before hitting that error?',
    },
    {
      label: 'Who is most affected?',
      prompt: 'Which users have hit that error most often in the last 7 days?',
    },
    {
      label: 'When did it start?',
      prompt:
        'Show me when that error first appeared and any deploy that landed nearby.',
    },
    {
      label: 'Suppress the noise',
      prompt: 'Suppress the noisiest error for now so I can focus.',
    },
  ],
  'query-trends': [
    {
      label: 'Save as dashboard',
      prompt: 'Save that as a dashboard called "Trends" and pin it.',
    },
    {
      label: 'Break down by property',
      prompt: 'Break that down by the most common user property.',
    },
    {
      label: 'Compare to last week',
      prompt: 'Compare that against the same period last month.',
    },
    {
      label: 'Build a funnel from it',
      prompt: 'Build a funnel using the top events from that trend.',
    },
    {
      label: 'Find the outlier day',
      prompt: 'Which day stood out the most and what else was going on?',
    },
    {
      label: 'Alert me on a drop',
      prompt: 'Alert me if that metric drops more than 20% week-over-week.',
    },
  ],
  'query-funnel': [
    {
      label: 'Find the biggest drop-off',
      prompt: 'Which step has the biggest drop-off, and who falls out there?',
    },
    {
      label: 'Cohort the bouncers',
      prompt: 'Create a cohort of people who dropped out at the biggest step.',
    },
    {
      label: 'Slice by platform',
      prompt: 'Show that funnel split by mobile vs desktop.',
    },
    {
      label: 'Look at completion time',
      prompt: 'How long does it take users who complete that funnel?',
    },
    {
      label: 'Compare two cohorts',
      prompt:
        'Compare that funnel between new signups and users older than 30 days.',
    },
    {
      label: 'A/B test a fix',
      prompt:
        'Set up an experiment to test a change at the biggest drop-off step.',
    },
  ],
  'create-feature-flag': [
    {
      label: 'Roll it out to 25%',
      prompt: 'Roll that flag out to 25% of users.',
    },
    {
      label: 'Add a kill-switch',
      prompt:
        'Create a kill-switch flag at 100% so I can disable the feature instantly.',
    },
    {
      label: 'See who is in',
      prompt: 'Show me which users are currently in that flag.',
    },
    {
      label: 'Wrap it in an experiment',
      prompt: 'Convert that flag into an A/B test with control + variant arms.',
    },
    {
      label: 'Schedule a ramp',
      prompt: 'Ramp that flag 10% → 25% → 50% → 100% over the next two weeks.',
    },
    {
      label: 'Filter to a cohort',
      prompt: 'Limit that flag rollout to beta users only.',
    },
  ],
  'create-dashboard': [
    {
      label: 'Add another tile',
      prompt: 'Add a tile showing daily active users to that dashboard.',
    },
    {
      label: 'Subscribe to weekly digest',
      prompt: 'Email me a weekly summary of that dashboard.',
    },
    {
      label: 'Share with the team',
      prompt: 'Make that dashboard shareable with the team.',
    },
    {
      label: 'Add a leaderboard tile',
      prompt: 'Add a top-10 users tile to that dashboard.',
    },
    {
      label: 'Annotate today',
      prompt: 'Annotate today on that dashboard as the launch baseline.',
    },
    {
      label: 'Compare to last quarter',
      prompt:
        'Add a tile comparing this quarter to the last on the same dashboard.',
    },
  ],
  'create-insight': [
    {
      label: 'Pin it to a dashboard',
      prompt: 'Pin that insight to my main dashboard.',
    },
    {
      label: 'Schedule a subscription',
      prompt: 'Email me that insight every Monday morning.',
    },
    {
      label: 'Split by user property',
      prompt: 'Split that insight by the most common user property.',
    },
    {
      label: 'Alert on a threshold',
      prompt: 'Alert me when that insight crosses an unusual value.',
    },
    {
      label: 'Compare to a control',
      prompt: 'Compare that insight between paid and free users side-by-side.',
    },
    {
      label: 'Save the underlying query',
      prompt: 'Save the SQL behind that insight so I can edit it later.',
    },
  ],
  'execute-sql': [
    {
      label: 'Materialize the result',
      prompt: 'Save that query as a materialized view I can reuse.',
    },
    {
      label: 'Chart it',
      prompt: 'Turn that into an insight with a line chart.',
    },
    {
      label: 'Slice differently',
      prompt: 'Re-run that query grouped by the most common user property.',
    },
    {
      label: 'Find the outliers',
      prompt: 'Re-run that query and surface the top 5 outliers.',
    },
    {
      label: 'Schedule it',
      prompt: 'Run that query every morning and post the result to Slack.',
    },
    {
      label: 'Add a percentile',
      prompt: "Add p50/p90/p99 to that query's result.",
    },
  ],
  'cohorts-create': [
    {
      label: 'Build a funnel for them',
      prompt:
        'Build a funnel showing how that cohort moves through onboarding.',
    },
    {
      label: 'Compare to everyone else',
      prompt: 'How does retention for that cohort compare to all other users?',
    },
    {
      label: 'Run an experiment',
      prompt: 'Run an A/B test limited to that cohort.',
    },
    {
      label: 'Survey them',
      prompt: 'Send an NPS survey to that cohort.',
    },
    {
      label: 'Target a flag',
      prompt: 'Limit a feature flag rollout to just that cohort.',
    },
    {
      label: 'Find a lookalike',
      prompt: 'Find a cohort that behaves like that one but is larger.',
    },
  ],
  'survey-create': [
    {
      label: 'Launch the survey',
      prompt: 'Launch that survey now.',
    },
    {
      label: 'Target a cohort',
      prompt: 'Only show that survey to active users from the last 7 days.',
    },
    {
      label: 'Add a follow-up question',
      prompt: 'Add an open-ended follow-up question to that survey.',
    },
    {
      label: 'Summarize early responses',
      prompt: 'Summarize the responses to that survey so far.',
    },
    {
      label: 'A/B test the wording',
      prompt:
        'Run two variants of that survey question and compare response rate.',
    },
  ],
};

// Role-specific candidates that supplement tool-specific suggestions.
// Used when the role is known; mixed into the candidate pool alongside
// the tool's own pool so a founder and an engineer running the same
// tool see different combined suggestions.
const ROLE_FOLLOW_UPS: Record<TailoredRole, FollowUp[]> = {
  founder: [
    {
      label: 'Pin it to the exec dashboard',
      prompt: 'Add that result to my exec dashboard.',
    },
    {
      label: 'Alert me if it tanks',
      prompt: 'Page me if that metric drops 10% week-over-week.',
    },
    {
      label: 'Tie it to revenue',
      prompt: 'How does that correlate with paid conversions?',
    },
    {
      label: 'Share with investors',
      prompt: 'Make a shareable view of that for our next board update.',
    },
  ],
  product: [
    {
      label: 'Build a funnel around it',
      prompt: 'Build a funnel that includes that step.',
    },
    {
      label: 'Wrap in an experiment',
      prompt: 'Run an A/B test on that change.',
    },
    {
      label: 'Cohort the high-intent users',
      prompt:
        'Create a cohort of users showing the strongest signal in that result.',
    },
    {
      label: 'Send a survey',
      prompt: 'Trigger a short survey to anyone in that cohort.',
    },
  ],
  leadership: [
    {
      label: 'Add to weekly digest',
      prompt: 'Subscribe me to a weekly email containing that view.',
    },
    {
      label: 'Compare to last quarter',
      prompt: 'How does that compare against the same period last quarter?',
    },
    {
      label: 'Slack the leadership channel',
      prompt: 'Send a Slack alert to leadership if that drifts significantly.',
    },
  ],
  marketing: [
    {
      label: 'Annotate the launch',
      prompt: 'Annotate today as the campaign launch on that chart.',
    },
    {
      label: 'Retarget the cohort',
      prompt: 'Build a retargetable cohort of users showing that behavior.',
    },
    {
      label: 'Tie back to channel',
      prompt: 'Split that result by acquisition channel.',
    },
    {
      label: 'A/B test the landing',
      prompt: 'Run an A/B test on the landing page driving that traffic.',
    },
  ],
  engineering: [
    {
      label: 'Surface the regression',
      prompt: 'Did that change land alongside a deploy in the last 24 hours?',
    },
    {
      label: 'Page on the SLO',
      prompt: 'Set up an SLO alert for that metric.',
    },
    {
      label: 'Kill-switch the cause',
      prompt:
        'Create a kill-switch flag for the feature most likely to be related.',
    },
    {
      label: 'Group by release',
      prompt: 'Re-run that broken down by app version or release.',
    },
  ],
  data: [
    {
      label: 'Save as SQL view',
      prompt: 'Save that query as a reusable SQL view.',
    },
    {
      label: 'Materialize it',
      prompt: 'Materialize the underlying table so future queries are faster.',
    },
    {
      label: 'Add percentiles',
      prompt: 'Add p50/p90/p99 distributions to that result.',
    },
    {
      label: 'Export to warehouse',
      prompt: 'Sync that result to my data warehouse.',
    },
  ],
};

const GENERIC_FOLLOW_UPS: FollowUp[] = [
  {
    label: 'Go one level deeper',
    prompt: 'Run that same question one level deeper.',
  },
  {
    label: 'Take a different angle',
    prompt: 'Look at the same question from a completely different angle.',
  },
  {
    label: 'Find the surprise',
    prompt: "What's the most surprising thing in that result?",
  },
  {
    label: 'Slice by user',
    prompt: 'Re-run that split by the highest-value user segment.',
  },
  {
    label: 'Compare with last month',
    prompt: 'How does that look compared to the same window a month ago.',
  },
  {
    label: 'Make it actionable',
    prompt: 'Turn that into an alert, dashboard, or saved insight.',
  },
];

// Late-tree candidates: shown when the user has gone several steps deep.
// Steer toward "wrap up / make it persistent" rather than "go deeper again".
const DEEP_DIVE_FOLLOW_UPS: FollowUp[] = [
  {
    label: 'Save this exploration',
    prompt:
      'Save the most useful chart from this session as a dashboard I can come back to.',
  },
  {
    label: 'Set up an alert',
    prompt:
      'Pick the most interesting metric from this session and alert me when it shifts.',
  },
  {
    label: 'Summarize what we found',
    prompt:
      'Summarize the key findings from everything we just looked at in 3 bullets.',
  },
];

/**
 * Strip MCP tool-name prefixes so lookup keys can stay short. Real MCP
 * tool names arrive as `mcp__<server>__<tool>`; the agent SDK also
 * sometimes drops the prefix. We take the substring after the last
 * double-underscore (or the input untouched if there's none).
 */
function normalizeToolName(toolName: string | null): string | null {
  if (!toolName) return null;
  const idx = toolName.lastIndexOf('__');
  return idx >= 0 ? toolName.slice(idx + 2) : toolName;
}

/** Pick `n` items from a pool starting at a rotation offset. */
function pickRotated<T>(pool: T[], n: number, rotation: number): T[] {
  if (pool.length === 0) return [];
  if (pool.length <= n) return pool;
  const start =
    ((Math.floor(rotation) % pool.length) + pool.length) % pool.length;
  const result: T[] = [];
  for (let i = 0; i < n; i++) {
    result.push(pool[(start + i) % pool.length]);
  }
  return result;
}

/** Drop duplicates while preserving order (by FollowUp.prompt). */
function dedupeFollowUps(list: FollowUp[]): FollowUp[] {
  const seen = new Set<string>();
  const out: FollowUp[] = [];
  for (const f of list) {
    if (seen.has(f.prompt)) continue;
    seen.add(f.prompt);
    out.push(f);
  }
  return out;
}

/**
 * Resolve `FOLLOW_UP_COUNT` context-aware follow-ups + an always-present
 * exit entry. Pulls from three pools — tool-specific, role-specific,
 * generic — and rotates by `branchHistory.length` so successive visits
 * show different slices. Prompts already in `branchHistory` are
 * filtered so the user never sees a repeat suggestion.
 */
export function getFollowUps(args: {
  lastToolName: string | null;
  lastPrompt: string;
  role: string | null | undefined;
  branchHistory: string[];
}): FollowUp[] {
  const { lastToolName, role, branchHistory } = args;
  const normalized = normalizeToolName(lastToolName);
  const depth = branchHistory.length;

  // Build the candidate pool — order matters because dedup keeps the
  // first occurrence. Tool-specific first (most relevant), then role,
  // then deep-dive (only after the user's been exploring), then generic.
  const candidates: FollowUp[] = [];
  if (normalized && TOOL_FOLLOW_UPS[normalized]) {
    candidates.push(...TOOL_FOLLOW_UPS[normalized]);
  }
  if (isTailoredRole(role)) {
    candidates.push(...ROLE_FOLLOW_UPS[role]);
  }
  if (depth >= 3) {
    candidates.push(...DEEP_DIVE_FOLLOW_UPS);
  }
  candidates.push(...GENERIC_FOLLOW_UPS);

  const deduped = dedupeFollowUps(candidates);
  const seen = new Set(branchHistory);
  const fresh = deduped.filter((f) => !seen.has(f.prompt));

  // Rotate by depth so repeat visits to the same tool surface different
  // slices of the pool. A user who keeps picking `query-trends` won't
  // see the same three options every time.
  const selected = pickRotated(fresh, FOLLOW_UP_COUNT, depth);

  return [...selected, EXIT_FOLLOW_UP];
}
