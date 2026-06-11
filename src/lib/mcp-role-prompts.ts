/**
 * Role + framework-tailored MCP prompt suggestions.
 *
 * All copy lives in `mcp-role-prompts.copy.json` so prompts can be
 * edited without touching TypeScript. This file holds the types,
 * the lookup functions, and the framework-family mapping.
 *
 * The wizard surfaces these on the McpSuggestedPromptsScreen after
 * MCP install. Picking strategy for the kit:
 *   1. Known role + known framework → role kit with family overrides.
 *   2. Known role + unknown framework → role kit, no overrides.
 *   3. Unknown role → DEFAULT_KIT.
 */

import type { Integration } from './constants';
import type {
  ProductPresence,
  ProjectDataProfile,
} from './mcp-project-profile';
import copyData from './mcp-role-prompts.copy.json';

/** Keys of `ProductPresence` — the products an activation cross-sell can target. */
export type ProductKey = keyof ProductPresence;

/**
 * Roles that ship from `role_at_organization` on the PostHog user object.
 * `security` isn't in the enum upstream — the engineering kit covers
 * that audience.
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

/**
 * Unified shape for every clickable picker entry the screen renders —
 * initial-picker kit prompts, cross-sell prompts, and follow-up prompts.
 * The three flavors are distinguished by which optional fields they
 * populate, not by separate types:
 *
 *   kit prompt         → { prompt, description }
 *   cross-sell prompt  → { prompt, description, product }
 *   follow-up prompt   → { prompt, label }
 */
export interface PromptOption {
  /** Sent to the agent when picked. Also serves as the picker label when `label` is omitted. */
  prompt: string;
  /** Optional picker label override. Follow-ups use this to show a short verb-phrase ("Save as dashboard") instead of the full prompt. */
  label?: string;
  /** Optional one-line description shown by the Goodbye sample list. */
  description?: string;
  /** Optional product tag — when present, picker prepends "Try {product} —" to the label. */
  product?: string;
  /** Stable identifier used by `roleFamilyOverrides` to target a kit entry by name (reorder-safe). Populated on kit entries; left out on cross-sells and follow-ups. */
  key?: string;
}

export type PromptKit = PromptOption[];

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

export interface RoleGreeting {
  /** 1-line hook — typewrites in. */
  headline: string;
  /** 2-3 lines of value framing — revealed line-by-line. */
  bullets: string[];
  /** Sets up the picker, e.g. "Pick one to try." — fades in. */
  outro: string;
}

export const FOLLOW_UP_EXIT_SENTINEL = '__follow_up_exit__';
/** How many follow-up suggestions to surface above the exit entry. */
export const FOLLOW_UP_COUNT = 3;

// ── Data loaded from JSON ──────────────────────────────────────────────
// One cast per top-level key. JSON imports lose the precise key
// constraints (e.g. Record<TailoredRole, ...>), so we re-attach them
// here. TypeScript can still catch shape mismatches at the call site.

/**
 * Always shown as the picker's first option regardless of role —
 * a safe generic read that works on any project setup. The screen
 * prepends it and dedupes against the role kit so it never appears
 * twice when DEFAULT_KIT happens to include it.
 */
export const PINNED_FIRST_PROMPT = copyData.pinnedFirstPrompt as PromptOption;

const DEFAULT_KIT = copyData.defaultKit as PromptKit;
const ROLE_KITS = copyData.roleKits as Record<TailoredRole, PromptKit>;
// Overrides are keyed by a base-kit entry's `key` (e.g. "onboarding",
// "top-errors") so a kit reorder doesn't silently shift overrides to
// the wrong slot. Each override is a partial PromptOption that gets
// merged onto the base entry.
const ROLE_FAMILY_OVERRIDES = copyData.roleFamilyOverrides as Partial<
  Record<
    TailoredRole,
    Partial<Record<FrameworkFamily, Record<string, PromptOption>>>
  >
>;
const ROLE_GREETINGS = copyData.roleGreetings as Record<
  TailoredRole,
  RoleGreeting
>;
const NEUTRAL_GREETING = copyData.neutralGreeting as RoleGreeting;
const TOOL_FOLLOW_UPS = copyData.toolFollowUps as Record<
  string,
  PromptOption[]
>;
const ROLE_FOLLOW_UPS = copyData.roleFollowUps as Record<
  TailoredRole,
  PromptOption[]
>;
const GENERIC_FOLLOW_UPS = copyData.genericFollowUps as PromptOption[];
const DEEP_DIVE_FOLLOW_UPS = copyData.deepDiveFollowUps as PromptOption[];
const CROSS_SELL_BY_ROLE = copyData.crossSellByRole as Record<
  TailoredRole,
  PromptOption[]
>;
const NEUTRAL_CROSS_SELL = copyData.neutralCrossSell as PromptOption[];

// Data-aware surfaces — templates + copy for the scout-driven picker.
const GENERATED_QUESTS = copyData.generatedQuests as {
  funnel: { label: string; prompt: string };
  trend: { label: string; prompt: string };
  breakdown: { label: string; prompt: string };
};
const WRITE_ONLY_QUESTS = copyData.writeOnlyQuests as PromptKit;
const ACTIVATION_CROSS_SELL = copyData.activationCrossSell as Record<
  ProductKey,
  PromptOption
>;
const SEED_OFFER_GREETING = copyData.seedOfferGreeting as RoleGreeting;

// ── Framework family map ───────────────────────────────────────────────
// Stays in code (not JSON) because it's structural data tied to the
// `Integration` enum, not user-facing copy.

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

const EXIT_FOLLOW_UP: PromptOption = {
  label: "I'm done — exit",
  prompt: FOLLOW_UP_EXIT_SENTINEL,
};

// ── Helpers ────────────────────────────────────────────────────────────

function isTailoredRole(role: string | null | undefined): role is TailoredRole {
  return (
    typeof role === 'string' &&
    (TAILORED_ROLES as readonly string[]).includes(role)
  );
}

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

/** Drop duplicates while preserving order (by prompt text). */
function dedupeFollowUps(list: PromptOption[]): PromptOption[] {
  const seen = new Set<string>();
  const out: PromptOption[] = [];
  for (const f of list) {
    if (seen.has(f.prompt)) continue;
    seen.add(f.prompt);
    out.push(f);
  }
  return out;
}

// ── Public API ─────────────────────────────────────────────────────────

export function getFrameworkFamily(
  integration: Integration | null | undefined,
): FrameworkFamily {
  if (!integration) return 'unknown';
  return INTEGRATION_FAMILY[integration] ?? 'unknown';
}

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

  // Look up overrides by each entry's stable `key` so a kit reorder
  // doesn't shift overrides to the wrong slot. An entry without a key,
  // or a key not present in the override map, passes through unchanged.
  return baseKit.map((entry) => {
    const override = entry.key ? overridesForFamily[entry.key] : undefined;
    return override ?? entry;
  });
}

export function getRoleGreeting(role: string | null | undefined): RoleGreeting {
  if (!isTailoredRole(role)) return NEUTRAL_GREETING;
  return ROLE_GREETINGS[role];
}

/**
 * Resolve `FOLLOW_UP_COUNT` context-aware follow-ups + an always-present
 * exit entry. Pulls from up to four pools — tool-specific, role-specific,
 * deep-dive (only after the user has explored a few steps), and generic —
 * dedupes, filters out anything already in `branchHistory`, then picks
 * `FOLLOW_UP_COUNT` with a rotation offset driven by `branchHistory.length`
 * so successive visits surface different slices.
 */
export function getFollowUps(args: {
  lastToolName: string | null;
  lastPrompt: string;
  role: string | null | undefined;
  branchHistory: string[];
}): PromptOption[] {
  const { lastToolName, role, branchHistory } = args;
  const normalized = normalizeToolName(lastToolName);
  const depth = branchHistory.length;

  // Build the candidate pool — order matters because dedup keeps the
  // first occurrence. Tool-specific first (most relevant), then role,
  // then deep-dive (only after the user's been exploring), then generic.
  const candidates: PromptOption[] = [];
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

/**
 * Cross-sell prompts to surface above the role kit in PromptPicker.
 * Filtered by role so the recommendations stay coherent (founders see
 * the "exec-friendly" cross-sells, engineers see "debug-friendly", etc).
 */
export function getCrossSellPrompts(
  role: string | null | undefined,
): PromptOption[] {
  if (!isTailoredRole(role)) return NEUTRAL_CROSS_SELL;
  return CROSS_SELL_BY_ROLE[role];
}

// ── Data-aware picker (scout-driven) ───────────────────────────────────
// Everything below consumes a ProjectDataProfile from the scout
// (`probeProjectData`) so the tutorial only ever offers playable moves:
// quests built from the project's real events when data exists, write-only
// quests + product-activation cross-sells when it doesn't.

/**
 * Order in which to offer activation cross-sells per role — products most
 * relevant to each audience first. Only products the scout found *absent*
 * are surfaced; this just picks which absent ones to lead with.
 */
const ACTIVATION_PRIORITY: Record<TailoredRole, ProductKey[]> = {
  founder: [
    'sessionReplay',
    'surveys',
    'webAnalytics',
    'experiments',
    'dataWarehouse',
    'errorTracking',
    'featureFlags',
  ],
  product: [
    'sessionReplay',
    'experiments',
    'surveys',
    'featureFlags',
    'webAnalytics',
    'errorTracking',
    'dataWarehouse',
  ],
  leadership: [
    'surveys',
    'dataWarehouse',
    'sessionReplay',
    'webAnalytics',
    'experiments',
    'errorTracking',
    'featureFlags',
  ],
  marketing: [
    'sessionReplay',
    'webAnalytics',
    'surveys',
    'experiments',
    'dataWarehouse',
    'featureFlags',
    'errorTracking',
  ],
  engineering: [
    'errorTracking',
    'sessionReplay',
    'featureFlags',
    'experiments',
    'webAnalytics',
    'dataWarehouse',
    'surveys',
  ],
  data: [
    'dataWarehouse',
    'experiments',
    'sessionReplay',
    'webAnalytics',
    'errorTracking',
    'surveys',
    'featureFlags',
  ],
};
const NEUTRAL_ACTIVATION_PRIORITY: ProductKey[] = [
  'sessionReplay',
  'errorTracking',
  'surveys',
  'webAnalytics',
  'experiments',
  'featureFlags',
  'dataWarehouse',
];

/** How many custom events to feed into a generated funnel prompt. */
const FUNNEL_EVENT_LIMIT = 4;

/** Fill `{placeholder}` tokens in a template; unknown tokens pass through. */
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(
    /\{(\w+)\}/g,
    (_, key: string) => vars[key] ?? `{${key}}`,
  );
}

export function getSeedOfferGreeting(): RoleGreeting {
  return SEED_OFFER_GREETING;
}

/**
 * Generate quests from the project's REAL event names (idea 9). Returns a
 * funnel (when ≥2 custom events exist), a trend, and a breakdown — all
 * templated off `topCustomEvents`. Empty when there's nothing usable to
 * build from (no profile, degraded, or no custom events), so callers fall
 * back to the static kit.
 */
export function getGeneratedQuests(
  profile: ProjectDataProfile | null | undefined,
): PromptOption[] {
  if (!profile || profile.degraded) return [];
  const custom = profile.topCustomEvents;
  if (custom.length === 0) return [];

  const out: PromptOption[] = [];
  const top = custom[0].name;

  if (custom.length >= 2) {
    const events = custom
      .slice(0, FUNNEL_EVENT_LIMIT)
      .map((e) => e.name)
      .join(', ');
    out.push({
      label: GENERATED_QUESTS.funnel.label,
      prompt: fillTemplate(GENERATED_QUESTS.funnel.prompt, { events }),
    });
  }
  out.push({
    label: fillTemplate(GENERATED_QUESTS.trend.label, { event: top }),
    prompt: fillTemplate(GENERATED_QUESTS.trend.prompt, { event: top }),
  });
  out.push({
    label: fillTemplate(GENERATED_QUESTS.breakdown.label, { event: top }),
    prompt: fillTemplate(GENERATED_QUESTS.breakdown.prompt, { event: top }),
  });
  return out;
}

/**
 * Activation cross-sells (idea 4) for products the scout found NO data
 * for — turning a data-less dead end into "here's how to turn this on".
 * Ordered by role affinity, capped at `limit`. Empty when the profile is
 * missing/degraded (we only nag when we're confident a product is absent).
 */
export function getActivationCrossSell(
  role: string | null | undefined,
  profile: ProjectDataProfile | null | undefined,
  limit = 2,
): PromptOption[] {
  if (!profile || profile.degraded) return [];
  const priority = isTailoredRole(role)
    ? ACTIVATION_PRIORITY[role]
    : NEUTRAL_ACTIVATION_PRIORITY;
  return priority
    .filter((key) => profile.products[key] === false)
    .slice(0, limit)
    .map((key) => ACTIVATION_CROSS_SELL[key])
    .filter((o): o is PromptOption => Boolean(o));
}

/**
 * The full, ordered candidate list for the tutorial picker, composed from
 * the scout's profile. The screen dedupes by prompt text and slices to its
 * display cap — this function owns *what* to offer and in what priority:
 *
 *   • no profile / degraded → legacy composition (pinned + cross-sell + kit)
 *   • empty                 → write-only quests + activation cross-sells
 *                             (no reads that would return nothing)
 *   • rich (+ real events)   → generated quests first, one activation nudge,
 *                             then role kit for flavor
 *   • sparse                → a safe pinned read + one generated quest +
 *                             role kit + one activation nudge
 */
export function getTutorialPicker(
  role: string | null | undefined,
  integration: Integration | null | undefined,
  profile: ProjectDataProfile | null | undefined,
): PromptOption[] {
  if (!profile || profile.degraded) {
    return [
      PINNED_FIRST_PROMPT,
      ...getCrossSellPrompts(role),
      ...getRolePrompts(role, integration),
    ];
  }

  if (profile.tier === 'empty') {
    return [...WRITE_ONLY_QUESTS, ...getActivationCrossSell(role, profile, 2)];
  }

  const generated = getGeneratedQuests(profile);

  if (profile.tier === 'rich' && generated.length > 0) {
    return [
      ...generated,
      ...getActivationCrossSell(role, profile, 1),
      ...getRolePrompts(role, integration),
    ];
  }

  // sparse — real but thin data: lead with a safe read, add one generated
  // quest if available, then role flavor and a single activation nudge.
  return [
    PINNED_FIRST_PROMPT,
    ...generated.slice(0, 1),
    ...getRolePrompts(role, integration),
    ...getActivationCrossSell(role, profile, 1),
  ];
}
