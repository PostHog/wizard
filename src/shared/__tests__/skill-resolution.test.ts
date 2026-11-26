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
        'sdk/posthog-node': [
          entry('sdk-posthog-node-v5', {
            tags: ['posthogSdks:posthog-node@4', 'posthogSdks:posthog-node@5'],
          }),
          entry('sdk-posthog-node-v6', {
            tags: ['posthogSdks:posthog-node@6', 'default'],
          }),
        ],
      },
    }).categories,
  ).flat();
  const resolved = (posthogSdks: string[]) =>
    resolveTraitSkills(sdkMenu, { posthogSdks }).map((e) => e.id);

  it('loads the skill for the installed major, and none for a major or SDK it has no skill for', () => {
    expect(resolved(['posthog-node@5'])).toEqual(['sdk-posthog-node-v5']);
    expect(resolved(['posthog-node@6'])).toEqual(['sdk-posthog-node-v6']);
    expect(resolved(['posthog-node@3'])).toEqual([]);
    expect(resolved(['posthog-js@1'])).toEqual([]);
  });
});
