import { describe, expect, it } from 'vitest';
import { prepareSkillMenu, type SkillEntry } from '@shared/skill-menu';
import { resolveSkill, resolveTraitSkills } from '@shared/skill-resolution';

const entry = (id: string, rest: Partial<SkillEntry> = {}): SkillEntry => ({
  id,
  name: id,
  downloadUrl: `http://localhost:8765/${id}.zip`,
  ...rest,
});

const MENU: SkillEntry[] = [
  entry('posthog-best-practices', { family: 'posthog-best-practices' }),
  entry('integration-nextjs-app-router', {
    family: 'integration',
    tags: ['nextjs', 'framework:nextjs', 'variant:app', 'default'],
  }),
  entry('integration-nextjs-pages-router', {
    family: 'integration',
    tags: ['nextjs', 'framework:nextjs', 'variant:pages'],
  }),
  entry('integration-react-native', {
    family: 'integration',
    tags: ['framework:react-native', 'default'],
  }),
  entry('integration-expo', {
    family: 'integration',
    tags: ['framework:react-native', 'variant:expo'],
  }),
  entry('integration-django', {
    family: 'integration',
    tags: ['framework:django'],
  }),
  entry('integration-react-vite', { family: 'integration', tags: ['react'] }),
  entry('error-tracking-step-django', {
    family: 'error-tracking-step',
    tags: ['integration', 'framework:django'],
  }),
];

const pick = (name: string, keys: Record<string, string[]>) =>
  resolveSkill(MENU, name, keys)?.id;

describe('resolveSkill', () => {
  it('returns the skill a menu id names, whatever the keys', () => {
    expect(pick('posthog-best-practices', {})).toBe('posthog-best-practices');
    expect(pick('integration-expo', { framework: ['django'] })).toBe(
      'integration-expo',
    );
  });

  it('picks nothing for a family when the run has no framework', () => {
    expect(pick('integration', {})).toBeUndefined();
    expect(pick('integration', { variant: ['pages'] })).toBeUndefined();
  });

  it('drops a skill whose match key disagrees with the run', () => {
    expect(
      pick('integration', { framework: ['nextjs'], variant: ['pages'] }),
    ).toBe('integration-nextjs-pages-router');
  });

  it('lets the default tag break a tie when the run has no value for a key', () => {
    expect(pick('integration', { framework: ['nextjs'] })).toBe(
      'integration-nextjs-app-router',
    );
  });

  it('ranks a skill that agrees on more keys above the default', () => {
    expect(
      pick('integration', { framework: ['react-native'], variant: ['expo'] }),
    ).toBe('integration-expo');
    expect(
      pick('integration', { framework: ['react-native'], variant: ['bare'] }),
    ).toBe('integration-react-native');
  });

  it('never picks a family skill that has no framework key', () => {
    expect(pick('integration', { framework: ['react'] })).toBeUndefined();
  });

  it('reads a family from the entry, never from a tag another family carries', () => {
    expect(pick('integration', { framework: ['django'] })).toBe(
      'integration-django',
    );
  });

  it('picks nothing when no skill carries the framework', () => {
    expect(pick('integration', { framework: ['cobol'] })).toBeUndefined();
    expect(pick('no-such-family', { framework: ['django'] })).toBeUndefined();
  });

  it('reads a match key that names a built-in object property as one the run has no value for', () => {
    const menu = [
      entry('integration-odd', {
        family: 'integration',
        tags: ['framework:nextjs', 'constructor:x', 'toString:y'],
      }),
    ];
    expect(
      resolveSkill(menu, 'integration', { framework: ['nextjs'] })?.id,
    ).toBe('integration-odd');
  });

  it('falls back to menu order when nothing else ranks', () => {
    const twins = [
      entry('first', { family: 'step', tags: ['framework:rails'] }),
      entry('second', { family: 'step', tags: ['framework:rails'] }),
    ];
    expect(resolveSkill(twins, 'step', { framework: ['rails'] })?.id).toBe(
      'first',
    );
  });
});

describe('resolveTraitSkills', () => {
  const sdkMenu = Object.values(
    prepareSkillMenu({
      categories: {
        'sdk/posthog-python': [
          entry('sdk-posthog-python-v7', {
            tags: [
              'sdkPython:3',
              'sdkPython:4',
              'sdkPython:5',
              'sdkPython:6',
              'sdkPython:7',
            ],
          }),
          entry('sdk-posthog-python-v8', {
            tags: ['sdkPython:8', 'default'],
          }),
        ],
        'sdk/posthog-node': [
          entry('sdk-posthog-node-v5', { tags: ['sdkNode:4', 'sdkNode:5'] }),
          entry('sdk-posthog-node-v6', { tags: ['sdkNode:6', 'default'] }),
        ],
        'sdk/posthog-go': [
          entry('sdk-posthog-go-v1', { tags: ['sdkGo:1'] }),
          entry('sdk-posthog-go-v2', { tags: ['sdkGo:2', 'default'] }),
        ],
        'sdk/posthog-rust': [
          entry('sdk-posthog-rust-v0', { tags: ['sdkRust:0'] }),
          entry('sdk-posthog-rust-v1', { tags: ['sdkRust:1', 'default'] }),
        ],
        'sdk/posthog-ios': [
          entry('sdk-posthog-ios-v3', { tags: ['sdkIos:3'] }),
          entry('sdk-posthog-ios-v4', { tags: ['sdkIos:4', 'default'] }),
        ],
        'sdk/posthog-android': [
          entry('sdk-posthog-android-v3', { tags: ['sdkAndroid:3'] }),
          entry('sdk-posthog-android-v4', {
            tags: ['sdkAndroid:4', 'default'],
          }),
        ],
        'sdk/posthog-flutter': [
          entry('sdk-posthog-flutter-v5', {
            tags: ['sdkFlutter:4', 'sdkFlutter:5'],
          }),
          entry('sdk-posthog-flutter-v6', {
            tags: ['sdkFlutter:6', 'default'],
          }),
        ],
        'sdk/posthog-kmp': [
          entry('sdk-posthog-kmp-v0', { tags: ['sdkKmp:0'] }),
          entry('sdk-posthog-kmp-v1', { tags: ['sdkKmp:1', 'default'] }),
        ],
      },
    }).categories,
  ).flat();

  it.each([
    [{ sdkPython: ['3'] }, 'sdk-posthog-python-v7'],
    [{ sdkPython: ['7'] }, 'sdk-posthog-python-v7'],
    [{ sdkPython: ['8'] }, 'sdk-posthog-python-v8'],
    [{ sdkNode: ['4'] }, 'sdk-posthog-node-v5'],
    [{ sdkNode: ['5'] }, 'sdk-posthog-node-v5'],
    [{ sdkNode: ['6'] }, 'sdk-posthog-node-v6'],
    [{ sdkGo: ['1'] }, 'sdk-posthog-go-v1'],
    [{ sdkGo: ['2'] }, 'sdk-posthog-go-v2'],
    [{ sdkRust: ['0'] }, 'sdk-posthog-rust-v0'],
    [{ sdkRust: ['1'] }, 'sdk-posthog-rust-v1'],
    [{ sdkIos: ['3'] }, 'sdk-posthog-ios-v3'],
    [{ sdkIos: ['4'] }, 'sdk-posthog-ios-v4'],
    [{ sdkAndroid: ['3'] }, 'sdk-posthog-android-v3'],
    [{ sdkAndroid: ['4'] }, 'sdk-posthog-android-v4'],
    [{ sdkFlutter: ['4'] }, 'sdk-posthog-flutter-v5'],
    [{ sdkFlutter: ['6'] }, 'sdk-posthog-flutter-v6'],
    [{ sdkKmp: ['0'] }, 'sdk-posthog-kmp-v0'],
    [{ sdkKmp: ['1'] }, 'sdk-posthog-kmp-v1'],
  ])('resolves BEFORE/AFTER keys %j -> %s', (keys, expectedId) => {
    expect(resolveTraitSkills(sdkMenu, keys).map((e) => e.id)).toEqual([
      expectedId,
    ]);
  });

  it('returns [] when flag is off (no trait keys) or major has no skill', () => {
    expect(resolveTraitSkills(sdkMenu, {})).toEqual([]);
    expect(resolveTraitSkills(sdkMenu, { framework: ['fastapi'] })).toEqual([]);
    expect(resolveTraitSkills(sdkMenu, { sdkPython: ['2'] })).toEqual([]);
  });

  it('ignores framework entries and picks matching trait skills when framework keys are present', () => {
    const mixed = [...MENU, ...sdkMenu];
    expect(
      resolveTraitSkills(mixed, {
        framework: ['nextjs'],
        frameworkVariant: ['app-router'],
        sdkNode: ['5'],
      }).map((e) => e.id),
    ).toEqual(['sdk-posthog-node-v5']);
  });

  it('uses default tiebreak within a trait family without disturbing framework resolution', () => {
    const combined = [
      ...MENU,
      entry('sdk-generic-default', {
        family: 'sdk-generic',
        tags: ['sdkCustom:1', 'default'],
      }),
      entry('sdk-generic-extra', {
        family: 'sdk-generic',
        tags: ['sdkCustom:1', 'variant:alt'],
      }),
    ];
    expect(
      resolveSkill(combined, 'sdk-generic', { sdkCustom: ['1'] })?.id,
    ).toBe('sdk-generic-default');
    expect(
      resolveSkill(combined, 'integration', { framework: ['django'] })?.id,
    ).toBe('integration-django');
  });
});
