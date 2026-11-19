/** PostHog SDK specifications shared across detection and agent runtime. */

import type { SkillEntry } from './skill-menu';
import { resolveSkill, type MatchKeys } from './skill-resolution';

export type PostHogSdkKey =
  | 'posthog-python'
  | 'posthog-node'
  | 'posthog-go'
  | 'posthog-rust'
  | 'posthog-ios'
  | 'posthog-android'
  | 'posthog-flutter';

export type PostHogSdkTraitName =
  | 'sdkPython'
  | 'sdkNode'
  | 'sdkGo'
  | 'sdkRust'
  | 'sdkIos'
  | 'sdkAndroid'
  | 'sdkFlutter';

export type PostHogSdkSpec = {
  readonly key: PostHogSdkKey;
  readonly trait: PostHogSdkTraitName;
  /** Menu skill family in context-mill when versioned SDK skills exist for this runtime. */
  readonly family?: string;
};

export const POSTHOG_SDK_SPECS: Readonly<
  Record<PostHogSdkKey, PostHogSdkSpec>
> = {
  'posthog-python': {
    key: 'posthog-python',
    trait: 'sdkPython',
    family: 'sdk-posthog-python',
  },
  'posthog-node': {
    key: 'posthog-node',
    trait: 'sdkNode',
    family: 'sdk-posthog-node',
  },
  'posthog-go': {
    key: 'posthog-go',
    trait: 'sdkGo',
    family: 'sdk-posthog-go',
  },
  'posthog-rust': {
    key: 'posthog-rust',
    trait: 'sdkRust',
    family: 'sdk-posthog-rust',
  },
  'posthog-ios': {
    key: 'posthog-ios',
    trait: 'sdkIos',
  },
  'posthog-android': {
    key: 'posthog-android',
    trait: 'sdkAndroid',
  },
  'posthog-flutter': {
    key: 'posthog-flutter',
    trait: 'sdkFlutter',
  },
};

const SPECS_BY_FAMILY = new Map<string, PostHogSdkSpec>(
  Object.values(POSTHOG_SDK_SPECS)
    .filter((spec): spec is PostHogSdkSpec & { family: string } =>
      Boolean(spec.family),
    )
    .map((spec) => [spec.family, spec]),
);

/** Look up the SDK spec associated with a menu skill family (`sdk-posthog-*`). */
export function sdkSpecForFamily(family: string): PostHogSdkSpec | undefined {
  return SPECS_BY_FAMILY.get(family);
}

/**
 * Which versioned `sdk-posthog-*` families apply to a run, from both the
 * detected PostHog SDK matchKeys and the framework's declared `sdkSkillFamily`.
 */
export function sdkFamiliesForRun(
  matchKeys: MatchKeys,
  frameworkSdkFamily?: string,
): string[] {
  const families = new Set<string>();
  for (const spec of Object.values(POSTHOG_SDK_SPECS)) {
    if (spec.family && matchKeys[spec.trait]?.length) {
      families.add(spec.family);
    }
  }
  if (frameworkSdkFamily) {
    families.add(frameworkSdkFamily);
  }
  return [...families];
}

export type ResolvedSdkSkillPick =
  | {
      kind: 'ok';
      family: string;
      spec?: PostHogSdkSpec;
      entry: SkillEntry;
      matchKeys: MatchKeys;
    }
  | {
      kind: 'no-skill';
      family: string;
      spec?: PostHogSdkSpec;
      major?: string;
    };

/**
 * Resolve every applicable `sdk-posthog-*` entry across all detected SDK majors
 * (splitting multi-major `matchKeys` per major so secondary majors are never dropped)
 * plus any greenfield framework SDK family.
 */
export function resolveSdkSkillEntries(opts: {
  menuEntries: readonly SkillEntry[];
  matchKeys: MatchKeys;
  frameworkSdkFamily?: string;
}): ResolvedSdkSkillPick[] {
  const { menuEntries, matchKeys, frameworkSdkFamily } = opts;
  const picks: ResolvedSdkSkillPick[] = [];

  for (const family of sdkFamiliesForRun(matchKeys, frameworkSdkFamily)) {
    const familyEntries = menuEntries.filter(
      (entry) => entry.family === family,
    );
    // Stub menus in unit tests or pre-release mirrors may omit sdk/* categories.
    if (familyEntries.length === 0) continue;

    const spec = sdkSpecForFamily(family);
    const detectedMajors = spec ? matchKeys[spec.trait] : undefined;
    const perMajorKeys: MatchKeys[] =
      spec && detectedMajors && detectedMajors.length > 1
        ? detectedMajors.map((major) => ({
            ...matchKeys,
            [spec.trait]: [major],
          }))
        : [matchKeys];

    for (const keys of perMajorKeys) {
      const entry = resolveSkill(menuEntries, family, keys);
      if (!entry) {
        const major = spec ? keys[spec.trait]?.[0] : undefined;
        picks.push({ kind: 'no-skill', family, spec, major });
        continue;
      }
      picks.push({ kind: 'ok', family, spec, entry, matchKeys: keys });
    }
  }

  return picks;
}
