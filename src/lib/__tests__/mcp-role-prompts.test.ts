import {
  getRolePrompts,
  getFrameworkFamily,
  getRoleLabel,
  VERIFY_PROMPT,
  TAILORED_ROLES,
} from '@lib/mcp-role-prompts';
import { Integration } from '@lib/constants';

describe('getRolePrompts', () => {
  it('falls back to DEFAULT_KIT when role is null', () => {
    const kit = getRolePrompts(null, Integration.nextjs);
    expect(kit[0]).toEqual(VERIFY_PROMPT);
    // DEFAULT_KIT advertises a generic top-events prompt at index 1.
    expect(kit[1].prompt).toMatch(/top 10 events/i);
  });

  it('falls back to DEFAULT_KIT when role is unrecognized', () => {
    const kit = getRolePrompts('not-a-real-role', Integration.nextjs);
    expect(kit[1].prompt).toMatch(/top 10 events/i);
  });

  it('returns the role kit when role is known and family has no overrides', () => {
    // nextjs → fullstack; no role has fullstack overrides today, so this
    // should be the unmodified product kit.
    const kit = getRolePrompts('product', Integration.nextjs);
    expect(kit[0]).toEqual(VERIFY_PROMPT);
    expect(kit[1].prompt).toMatch(/onboarding flow/i);
    expect(kit[3].prompt).toBe('A/B test the redesigned upgrade CTA');
  });

  it('falls back to the role kit when integration is null', () => {
    const kit = getRolePrompts('product', null);
    expect(kit[3].prompt).toBe('A/B test the redesigned upgrade CTA');
  });

  it('applies role × family overrides at the right indices', () => {
    // product × mobile overrides [1] and [3].
    const kit = getRolePrompts('product', Integration.swift);
    expect(kit[1].prompt).toMatch(/app_open → onboarding_complete/);
    expect(kit[3].prompt).toMatch(/app version/);
    // [2] is not overridden, so it stays as the role kit's prompt.
    expect(kit[2].prompt).toMatch(/new pricing page/);
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

describe('getRoleLabel', () => {
  it('returns null for unknown roles', () => {
    expect(getRoleLabel(null)).toBeNull();
    expect(getRoleLabel('not-a-role')).toBeNull();
  });

  it('returns labels for every TAILORED_ROLES entry', () => {
    for (const role of TAILORED_ROLES) {
      expect(getRoleLabel(role)).toMatch(/^\w/);
    }
  });
});
