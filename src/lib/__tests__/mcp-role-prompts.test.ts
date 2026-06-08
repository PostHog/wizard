import {
  getRolePrompts,
  getFrameworkFamily,
  getRoleGreeting,
  getFollowUps,
  getCrossSellPrompts,
  FOLLOW_UP_EXIT_SENTINEL,
  TAILORED_ROLES,
} from '@lib/mcp-role-prompts';
import { Integration } from '@lib/constants';

// The first entry of every role kit (and DEFAULT_KIT) is the dated
// annotation prompt. Tests assert against its prompt text rather than
// a shared constant — VERIFY_PROMPT was removed in the Phase 1 cull.
const ANNOTATION_PROMPT = "Annotate today with 'PostHog wizard install'";

describe('getRolePrompts', () => {
  it('falls back to DEFAULT_KIT when role is null', () => {
    const kit = getRolePrompts(null, Integration.nextjs);
    expect(kit[0].prompt).toBe(ANNOTATION_PROMPT);
    // DEFAULT_KIT advertises a generic top-events prompt at index 1.
    expect(kit[1].prompt).toMatch(/top 5 events/i);
  });

  it('falls back to DEFAULT_KIT when role is unrecognized', () => {
    const kit = getRolePrompts('not-a-real-role', Integration.nextjs);
    expect(kit[1].prompt).toMatch(/top 5 events/i);
  });

  it('returns the role kit when role is known and family has no overrides', () => {
    // nextjs → fullstack; no role has fullstack overrides today, so this
    // should be the unmodified product kit.
    const kit = getRolePrompts('product', Integration.nextjs);
    expect(kit[0].prompt).toBe(ANNOTATION_PROMPT);
    expect(kit[1].prompt).toMatch(/onboarding flow/i);
    expect(kit[3].prompt).toMatch(/upgrade CTA/i);
  });

  it('falls back to the role kit when integration is null', () => {
    const kit = getRolePrompts('product', null);
    expect(kit[3].prompt).toMatch(/upgrade CTA/i);
  });

  it('applies role × family overrides at the right indices', () => {
    // product × mobile overrides [1] and [3].
    const kit = getRolePrompts('product', Integration.swift);
    expect(kit[1].prompt).toMatch(/app_open → onboarding_complete/);
    expect(kit[3].prompt).toMatch(/app version/);
    // [2] is not overridden, so it stays as the role kit's prompt.
    expect(kit[2].prompt).toMatch(/pricing page/i);
  });

  it('applies overrides individually (one index does not affect others)', () => {
    // engineering × backend overrides both [2] and [3].
    const kit = getRolePrompts('engineering', Integration.django);
    expect(kit[2].prompt).toMatch(/server-side errors/);
    expect(kit[3].prompt).toMatch(/p95 response time/);
    // [1] is untouched.
    expect(kit[1].prompt).toMatch(/100%.*safe to delete/i);
  });
});

describe('getFrameworkFamily', () => {
  it('returns "unknown" for null', () => {
    expect(getFrameworkFamily(null)).toBe('unknown');
  });

  it('maps fullstack frameworks correctly', () => {
    expect(getFrameworkFamily(Integration.nextjs)).toBe('fullstack');
    expect(getFrameworkFamily(Integration.sveltekit)).toBe('fullstack');
    expect(getFrameworkFamily(Integration.astro)).toBe('fullstack');
  });

  it('maps mobile frameworks correctly', () => {
    expect(getFrameworkFamily(Integration.swift)).toBe('mobile');
    expect(getFrameworkFamily(Integration.android)).toBe('mobile');
  });

  it('maps backend frameworks correctly', () => {
    expect(getFrameworkFamily(Integration.django)).toBe('backend');
    expect(getFrameworkFamily(Integration.flask)).toBe('backend');
    expect(getFrameworkFamily(Integration.fastapi)).toBe('backend');
    expect(getFrameworkFamily(Integration.rails)).toBe('backend');
    expect(getFrameworkFamily(Integration.laravel)).toBe('backend');
  });

  it('maps frontend-web frameworks correctly', () => {
    expect(getFrameworkFamily(Integration.vue)).toBe('frontend-web');
    expect(getFrameworkFamily(Integration.angular)).toBe('frontend-web');
  });
});

describe('getRoleGreeting', () => {
  it('returns a neutral greeting for null role', () => {
    const g = getRoleGreeting(null);
    expect(g.headline).toBeTruthy();
    expect(g.bullets.length).toBeGreaterThan(0);
    expect(g.outro).toBeTruthy();
  });

  it('returns the neutral greeting for unknown roles', () => {
    const g = getRoleGreeting('not-a-real-role');
    // The neutral greeting always mentions MCP somewhere — sanity check.
    expect(g.headline).toMatch(/MCP/i);
  });

  it('returns a populated greeting for every TAILORED_ROLE', () => {
    for (const role of TAILORED_ROLES) {
      const g = getRoleGreeting(role);
      expect(g.headline).toBeTruthy();
      expect(g.bullets.length).toBeGreaterThanOrEqual(2);
      expect(g.outro).toBeTruthy();
    }
  });

  it('uses distinct headlines per role', () => {
    const headlines = new Set(
      TAILORED_ROLES.map((r) => getRoleGreeting(r).headline),
    );
    expect(headlines.size).toBe(TAILORED_ROLES.length);
  });
});

describe('getFollowUps', () => {
  const baseArgs = {
    lastPrompt: '',
    role: null,
    branchHistory: [] as string[],
  };

  it('returns generic follow-ups + exit when no tool was used', () => {
    const fs = getFollowUps({ ...baseArgs, lastToolName: null });
    expect(fs.length).toBeGreaterThan(1);
    // Exit is always the final entry.
    expect(fs[fs.length - 1].prompt).toBe(FOLLOW_UP_EXIT_SENTINEL);
  });

  it('returns tool-specific follow-ups when the tool is known', () => {
    const fs = getFollowUps({
      ...baseArgs,
      lastToolName: 'query-error-tracking-issue',
    });
    // 3 tool-specific + exit
    expect(fs).toHaveLength(4);
    expect(fs[0].label).toMatch(/stack trace/i);
    expect(fs[fs.length - 1].prompt).toBe(FOLLOW_UP_EXIT_SENTINEL);
  });

  it('normalizes MCP-prefixed tool names', () => {
    const direct = getFollowUps({
      ...baseArgs,
      lastToolName: 'query-trends',
    });
    const prefixed = getFollowUps({
      ...baseArgs,
      lastToolName: 'mcp__posthog-wizard__query-trends',
    });
    expect(prefixed[0].label).toBe(direct[0].label);
  });

  it('falls back to generic follow-ups for unknown tool names', () => {
    const fs = getFollowUps({
      ...baseArgs,
      lastToolName: 'something-the-server-might-add-later',
    });
    // Unknown tool → candidate pool is just the generic set. Use a loose
    // match against any current generic label to stay resilient to copy
    // tweaks; the strong assertion is that we got generics, not a stale
    // tool-specific lookup.
    expect(fs[0].label).toMatch(
      /deeper|angle|surprise|slice|compare|actionable/i,
    );
    expect(fs[fs.length - 1].prompt).toBe(FOLLOW_UP_EXIT_SENTINEL);
  });

  it('rotates suggestions by branch depth so visits differ', () => {
    // Same tool, no history — but different depths should surface
    // different first picks because of the rotation offset.
    const shallow = getFollowUps({
      ...baseArgs,
      lastToolName: 'query-trends',
      branchHistory: [],
    });
    const deeper = getFollowUps({
      ...baseArgs,
      lastToolName: 'query-trends',
      // Synthetic prompts the rotation doesn't filter against.
      branchHistory: ['__unrelated_a__', '__unrelated_b__'],
    });
    expect(shallow[0].prompt).not.toBe(deeper[0].prompt);
  });

  it('mixes in role-specific candidates for known roles', () => {
    // Pool size larger than FOLLOW_UP_COUNT, so when role is set we
    // should sometimes see role-flavored phrasing surface. Pick a depth
    // that rotates past the tool-specific block into role territory.
    const founderResult = getFollowUps({
      lastPrompt: '',
      branchHistory: ['a', 'b', 'c', 'd', 'e', 'f'],
      role: 'founder',
      lastToolName: 'query-trends',
    });
    const engineerResult = getFollowUps({
      lastPrompt: '',
      branchHistory: ['a', 'b', 'c', 'd', 'e', 'f'],
      role: 'engineering',
      lastToolName: 'query-trends',
    });
    // Same tool + same depth but different roles → different slices.
    const founderLabels = founderResult.map((f) => f.label).join('|');
    const engineerLabels = engineerResult.map((f) => f.label).join('|');
    expect(founderLabels).not.toBe(engineerLabels);
  });

  it('always appends the exit follow-up regardless of input', () => {
    for (const toolName of [null, 'query-trends', 'unknown']) {
      const fs = getFollowUps({ ...baseArgs, lastToolName: toolName });
      expect(fs[fs.length - 1].prompt).toBe(FOLLOW_UP_EXIT_SENTINEL);
      expect(fs[fs.length - 1].label).toMatch(/exit|done/i);
    }
  });

  it('filters out prompts already in branchHistory', () => {
    const all = getFollowUps({
      ...baseArgs,
      lastToolName: 'query-trends',
    });
    // Drop the exit entry; pick a real follow-up to repeat.
    const repeated = all[0].prompt;
    const filtered = getFollowUps({
      ...baseArgs,
      lastToolName: 'query-trends',
      branchHistory: [repeated],
    });
    expect(filtered.find((f) => f.prompt === repeated)).toBeUndefined();
    // Exit still present.
    expect(filtered[filtered.length - 1].prompt).toBe(FOLLOW_UP_EXIT_SENTINEL);
  });
});

describe('getCrossSellPrompts', () => {
  it('returns neutral cross-sells when role is null', () => {
    const prompts = getCrossSellPrompts(null);
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) {
      expect(p.product).toBeTruthy();
      expect(p.prompt).toBeTruthy();
      expect(p.description).toBeTruthy();
    }
  });

  it('returns neutral cross-sells for unknown roles', () => {
    const prompts = getCrossSellPrompts('not-a-real-role');
    expect(prompts.length).toBeGreaterThan(0);
  });

  it('returns role-specific cross-sells for every TAILORED_ROLE', () => {
    for (const role of TAILORED_ROLES) {
      const prompts = getCrossSellPrompts(role);
      expect(prompts.length).toBeGreaterThan(0);
      for (const p of prompts) {
        expect(p.product).toBeTruthy();
        expect(p.prompt).toBeTruthy();
      }
    }
  });

  it('produces distinct cross-sell sets across roles', () => {
    // Guards against accidental copy-paste that would collapse multiple
    // roles to the same cross-sell list. Threshold is loose enough to
    // tolerate intentional overlap (engineer + data both pitching SQL
    // would be fine).
    const fingerprints = new Set(
      TAILORED_ROLES.map((r) =>
        getCrossSellPrompts(r)
          .map((p) => `${p.product ?? ''}:${p.prompt}`)
          .join('|'),
      ),
    );
    expect(fingerprints.size).toBeGreaterThanOrEqual(3);
  });
});
