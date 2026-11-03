import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { expandBundleEntry, type SkillMenu } from '@shared/skill-menu';
import { parseAgentPrompt } from '../../../../agent-prompt-loader';
import { createSkillPicker, resolveSkillVariantId } from '../skill-picks';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));

const FIXTURES = path.resolve(__dirname, '../../../../../../fixtures');

// The recorded release, plus a context-mill build when CONTEXT_MILL_MENU names its skill-menu.json.
const MENUS: Array<[string, string]> = [
  ['recorded release', path.join(FIXTURES, 'context-mill', 'skill-menu.json')],
  ...(process.env.CONTEXT_MILL_MENU
    ? [['CONTEXT_MILL_MENU', process.env.CONTEXT_MILL_MENU] as [string, string]]
    : []),
];

/** Every skill id an agent prompt names, plus the framework reference. */
function promptSkillIds(): string[] {
  const root = path.join(FIXTURES, 'context-mill', 'agents');
  const ids = new Set(['integration']);
  for (const flow of fs.readdirSync(root)) {
    for (const file of fs.readdirSync(path.join(root, flow))) {
      const text = fs.readFileSync(path.join(root, flow, file), 'utf8');
      for (const id of parseAgentPrompt(text, file).skills) ids.add(id);
    }
  }
  return [...ids].sort();
}

describe.each(MENUS)('criteria resolver equivalence (%s)', (_, file) => {
  const menu = JSON.parse(fs.readFileSync(file, 'utf8')) as SkillMenu;
  const entries = Object.values(menu.categories)
    .flat()
    .flatMap(expandBundleEntry);
  const frameworks = [
    undefined,
    ...new Set(entries.flatMap((e) => (e.framework ? [e.framework] : []))),
  ];

  it('picks what the exact-match resolver picks, for every prompt skill and framework', () => {
    const disagreements: string[] = [];
    for (const framework of frameworks) {
      const picker = createSkillPicker({
        entries,
        framework,
        traits: {},
        useCriteria: true,
      });
      for (const skillId of promptSkillIds()) {
        const legacy = resolveSkillVariantId(entries, skillId, framework);
        const judged =
          skillId === 'integration' && framework
            ? picker.reference()
            : picker.pick('task', skillId);
        if (judged !== legacy) {
          disagreements.push(
            `${skillId} @ ${framework ?? 'none'}: ${legacy ?? 'none'} vs ${
              judged ?? 'none'
            }`,
          );
        }
      }
    }
    expect(disagreements).toEqual([]);
  });
});
