import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  prepareSkillMenu,
  type SkillEntry,
  type SkillMenu,
} from '@shared/skill-menu';
import { filterSkillsForRun, resolveSkill } from '@shared/skill-resolution';

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

  describe('non-framework families (sdk-posthog-*)', () => {
    const SDK_MENU: SkillEntry[] = [
      entry('sdk-posthog-python-v7', {
        family: 'sdk-posthog-python',
        tags: ['sdk-python-7', 'sdkPython:7', 'sdk-posthog-python'],
      }),
      entry('sdk-posthog-python-v8', {
        family: 'sdk-posthog-python',
        tags: ['sdk-python-8', 'sdkPython:8', 'sdk-posthog-python', 'default'],
      }),
      entry('sdk-posthog-node-v5', {
        family: 'sdk-posthog-node',
        tags: ['sdk-node-5', 'sdkNode:5', 'sdk-posthog-node'],
      }),
      entry('sdk-posthog-node-v6', {
        family: 'sdk-posthog-node',
        tags: ['sdk-node-6', 'sdkNode:6', 'sdk-posthog-node', 'default'],
      }),
    ];

    it('resolves the default major when sdk trait is absent on greenfield runs', () => {
      expect(resolveSkill(SDK_MENU, 'sdk-posthog-python', {})?.id).toBe(
        'sdk-posthog-python-v8',
      );
      expect(
        resolveSkill(SDK_MENU, 'sdk-posthog-python', { framework: ['django'] })
          ?.id,
      ).toBe('sdk-posthog-python-v8');
    });

    it('resolves exact major when sdk trait is set and isolates multi-SDK full-stack runs', () => {
      expect(
        resolveSkill(SDK_MENU, 'sdk-posthog-python', {
          framework: ['django'],
          sdkPython: ['7'],
        })?.id,
      ).toBe('sdk-posthog-python-v7');
      expect(
        resolveSkill(SDK_MENU, 'sdk-posthog-node', {
          framework: ['nextjs'],
          sdkNode: ['5'],
        })?.id,
      ).toBe('sdk-posthog-node-v5');
    });

    it('returns undefined when installed major is unsupported by all entries', () => {
      expect(
        resolveSkill(SDK_MENU, 'sdk-posthog-python', {
          framework: ['django'],
          sdkPython: ['3'],
        }),
      ).toBeUndefined();
    });

    it('filters menu entries for load_skill_menu to matching variants', () => {
      expect(
        filterSkillsForRun(
          SDK_MENU.filter((e) => e.family === 'sdk-posthog-python'),
          { framework: ['django'], sdkPython: ['7'] },
        ).map((e) => e.id),
      ).toEqual(['sdk-posthog-python-v7']);

      expect(
        filterSkillsForRun(
          SDK_MENU.filter((e) => e.family === 'sdk-posthog-node'),
          { framework: ['nextjs'], sdkNode: ['5', '6'] },
        ).map((e) => e.id),
      ).toEqual(['sdk-posthog-node-v5', 'sdk-posthog-node-v6']);

      expect(
        filterSkillsForRun(MENU, {
          framework: ['nextjs'],
          variant: ['pages'],
        }).map((e) => e.id),
      ).not.toContain('integration-nextjs-app-router');

      expect(
        filterSkillsForRun(
          MENU.filter((e) => e.family === 'integration'),
          { framework: ['cobol'] },
        ).map((e) => e.id),
      ).toEqual(['integration-react-vite']);
    });

    it('preserves real ai-observability entries whose framework:<provider> tags are LLM providers rather than wizard integrations', () => {
      const fixturePath = path.resolve(
        __dirname,
        '../../../fixtures/context-mill/skill-menu.json',
      );
      const rawMenu = JSON.parse(
        fs.readFileSync(fixturePath, 'utf8'),
      ) as SkillMenu;
      const menu = prepareSkillMenu(rawMenu);
      const aioEntries = menu.categories['ai-observability'] ?? [];
      expect(aioEntries.length).toBeGreaterThan(0);

      const filtered = filterSkillsForRun(aioEntries, {
        framework: ['nextjs'],
        sdkNode: ['5'],
      });
      expect(filtered).toHaveLength(aioEntries.length);
      expect(filtered.map((e) => e.id)).toContain(
        'ai-observability-anthropic-node',
      );
      expect(filtered.map((e) => e.id)).toContain(
        'ai-observability-openai-python',
      );
    });
  });
});
