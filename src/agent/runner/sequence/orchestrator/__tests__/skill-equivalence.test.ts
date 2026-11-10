import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { expandBundleEntry, type SkillMenu } from '@shared/skill-menu';
import {
  DEFAULT_SKILL_TAG,
  FRAMEWORK_KEY,
  resolveSkill,
} from '@shared/skill-resolution';
import { resolveSkillVariantId } from '../orchestrator-runner';

const FIXTURES = path.resolve(__dirname, '../../../../../../fixtures');

// The recorded menu, plus a context-mill build when CONTEXT_MILL_MENU names its skill-menu.json.
const MENUS: Array<[string, string]> = [
  ['recorded menu', path.join(FIXTURES, 'context-mill', 'skill-menu.json')],
  ...(process.env.CONTEXT_MILL_MENU
    ? [['CONTEXT_MILL_MENU', process.env.CONTEXT_MILL_MENU] as [string, string]]
    : []),
];

it('records a menu whose entries carry tags', () => {
  const menu = JSON.parse(fs.readFileSync(MENUS[0][1], 'utf8')) as SkillMenu;
  const entries = Object.values(menu.categories).flat();
  expect(entries.filter((entry) => entry.tags?.length).length).toBeGreaterThan(
    100,
  );
});

describe.each(MENUS)('skill resolver equivalence (%s)', (_, file) => {
  const menu = JSON.parse(fs.readFileSync(file, 'utf8')) as SkillMenu;
  const entries = Object.values(menu.categories)
    .flat()
    .flatMap(expandBundleEntry);
  // Every name a prompt can use: each skill family, each menu id.
  const names = [
    ...new Set(entries.flatMap((e) => (e.group ? [e.group, e.id] : [e.id]))),
  ];
  const frameworks = [
    undefined,
    'no-such-framework',
    ...new Set(entries.flatMap((e) => (e.framework ? [e.framework] : []))),
  ];

  it('covers a menu with skill families and frameworks', () => {
    expect(names.length).toBeGreaterThan(100);
    expect(frameworks.length).toBeGreaterThan(20);
  });

  // The menu lookup reads the fields and the resolver also reads the tags, so the two must say the same.
  it('declares the same framework and default in its tags as in its fields', () => {
    const disagreeing = entries
      .filter((entry) => entry.tags)
      .filter((entry) => {
        const tags = entry.tags ?? [];
        const frameworkTags = tags.filter((tag) =>
          tag.startsWith(`${FRAMEWORK_KEY}:`),
        );
        const fromField = entry.framework
          ? [`${FRAMEWORK_KEY}:${entry.framework}`]
          : [];
        return (
          frameworkTags.join() !== fromField.join() ||
          tags.includes(DEFAULT_SKILL_TAG) !== (entry.default === true)
        );
      })
      .map((entry) => entry.id);
    expect(disagreeing).toEqual([]);
  });

  it('picks what the menu lookup picks, for every name and framework', () => {
    const differences: string[] = [];
    for (const framework of frameworks) {
      const keys = framework ? { framework: [framework] } : {};
      for (const name of names) {
        const before = resolveSkillVariantId(entries, name, framework);
        const after = resolveSkill(entries, name, keys)?.id;
        if (before !== after) {
          differences.push(
            `${name} @ ${framework ?? 'none'}: ${before ?? 'none'} vs ${
              after ?? 'none'
            }`,
          );
        }
      }
    }
    expect(differences).toEqual([]);
  });
});
