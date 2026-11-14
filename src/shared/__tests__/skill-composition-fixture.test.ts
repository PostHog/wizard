import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  compareSkillFiles,
  composeStepSkill,
  type SkillFiles,
} from '@shared/skill-composition';

// A pair recorded from a context-mill build: this fill is a copy of context-mill's, and the pair keeps the two in step.
describe('a recorded context-mill pair', () => {
  const root = path.resolve(
    __dirname,
    '../../../fixtures/context-mill/repackaged',
  );
  const tree = (dir: string, prefix = ''): SkillFiles =>
    Object.assign(
      {},
      ...fs.readdirSync(dir, { withFileTypes: true }).map((entry) =>
        entry.isDirectory()
          ? tree(path.join(dir, entry.name), `${prefix}${entry.name}/`)
          : {
              [`${prefix}${entry.name}`]: fs.readFileSync(
                path.join(dir, entry.name),
                'utf8',
              ),
            },
      ),
    ) as SkillFiles;
  it('completes the recorded step from the recorded pack into the skill it replaces', () => {
    const pair = JSON.parse(
      fs.readFileSync(path.join(root, 'pair.json'), 'utf8'),
    ) as { product: string };
    const original = tree(path.join(root, 'original'));

    const composed = composeStepSkill(
      tree(path.join(root, 'step')),
      tree(path.join(root, 'pack')),
      pair.product,
    );

    expect(compareSkillFiles(original, composed)).toEqual([]);
    expect(composed['SKILL.md']).not.toBe(original['SKILL.md']);
  });
});
