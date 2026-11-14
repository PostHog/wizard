import { describe, expect, it } from 'vitest';
import type { SkillEntry } from '@shared/skill-menu';
import {
  resolveReplacement,
  resolveSkill,
  skillTags,
} from '@shared/skill-resolution';

const entry = (id: string, rest: Partial<SkillEntry> = {}): SkillEntry => ({
  id,
  name: id,
  downloadUrl: `http://localhost:8765/${id}.zip`,
  ...rest,
});

const MENU: SkillEntry[] = [
  entry('posthog-best-practices', { group: 'posthog-best-practices' }),
  entry('integration-nextjs-app-router', {
    group: 'integration',
    tags: ['nextjs', 'framework:nextjs', 'variant:app', 'default'],
  }),
  entry('integration-nextjs-pages-router', {
    group: 'integration',
    tags: ['nextjs', 'framework:nextjs', 'variant:pages'],
  }),
  entry('integration-react-native', {
    group: 'integration',
    tags: ['framework:react-native', 'default'],
  }),
  entry('integration-expo', {
    group: 'integration',
    tags: ['framework:react-native', 'variant:expo'],
  }),
  entry('integration-django', { group: 'integration', framework: 'django' }),
  entry('integration-react-vite', { group: 'integration', tags: ['react'] }),
  entry('error-tracking-step-django', {
    group: 'error-tracking-step',
    tags: ['integration', 'framework:django'],
  }),
];

const pick = (name: string, keys: Record<string, string[]>) =>
  resolveSkill(MENU, name, keys)?.id;

describe('skillTags', () => {
  it('reads framework and default as tags, so a menu without tags resolves the same', () => {
    expect([
      ...skillTags(entry('a', { framework: 'rails', default: true })),
    ]).toEqual(['framework:rails', 'default']);
  });
});

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

  it('reads a family from the group, never from a tag another family carries', () => {
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
        group: 'integration',
        tags: ['framework:nextjs', 'constructor:x', 'toString:y'],
      }),
    ];
    expect(
      resolveSkill(menu, 'integration', { framework: ['nextjs'] })?.id,
    ).toBe('integration-odd');
  });

  it('falls back to menu order when nothing else ranks', () => {
    const twins = [
      entry('first', { group: 'step', framework: 'rails' }),
      entry('second', { group: 'step', framework: 'rails' }),
    ];
    expect(resolveSkill(twins, 'step', { framework: ['rails'] })?.id).toBe(
      'first',
    );
  });
});

describe('resolveReplacement', () => {
  const entries = [
    ...MENU,
    entry('integration-install', { replaces: 'integration-v2-install' }),
  ];

  it('finds the skill that stands in for a name', () => {
    expect(resolveReplacement(entries, 'integration-v2-install')?.id).toBe(
      'integration-install',
    );
  });

  it('finds none for a name nothing replaces, or for the replacement itself', () => {
    expect(resolveReplacement(entries, 'integration')).toBeUndefined();
    expect(resolveReplacement(entries, 'integration-install')).toBeUndefined();
  });
});
