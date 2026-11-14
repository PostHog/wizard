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
const RECORDED = path.join(FIXTURES, 'context-mill', 'skill-menu.json');

const readMenu = (file: string): SkillMenu =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as SkillMenu;

/** The menu as a release with no menu metadata publishes it: no entry or bundle variant carries tags. */
const readMenuWithoutTags = (file: string): SkillMenu =>
  JSON.parse(fs.readFileSync(file, 'utf8'), (key, value: unknown) =>
    key === 'tags' ? undefined : value,
  ) as SkillMenu;

// The recorded menu, the same menu with no tags, and a context-mill build when CONTEXT_MILL_MENU names its skill-menu.json.
const MENUS: Array<[string, () => SkillMenu]> = [
  ['recorded menu', () => readMenu(RECORDED)],
  ['recorded menu without tags', () => readMenuWithoutTags(RECORDED)],
  ...(process.env.CONTEXT_MILL_MENU
    ? [
        [
          'CONTEXT_MILL_MENU',
          () => readMenu(process.env.CONTEXT_MILL_MENU as string),
        ] as [string, () => SkillMenu],
      ]
    : []),
];

const allEntries = (menu: SkillMenu) =>
  Object.values(menu.categories)
    .flat()
    .flatMap((entry) => [entry, ...(entry.variants ?? [])]);

it('records a menu whose entries carry tags', () => {
  const tagged = allEntries(readMenu(RECORDED)).filter(
    (entry) => entry.tags?.length,
  );
  expect(tagged.length).toBeGreaterThan(100);
});

it('reads the recorded menu with no tags left on any entry or variant', () => {
  const tagged = allEntries(readMenuWithoutTags(RECORDED)).filter(
    (entry) => entry.tags,
  );
  expect(tagged).toEqual([]);
});

describe.each(MENUS)('skill resolver equivalence (%s)', (_, read) => {
  const menu = read();
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
