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
import copyData from './mcp-role-prompts.copy.json';

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
