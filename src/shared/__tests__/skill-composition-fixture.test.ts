import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { composeStepSkill, type SkillFiles } from '@shared/skill-composition';

// `completed/` is the skill context-mill itself published for the pair's framework, so this fill is checked against context-mill's own.
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
  // The two skills carry different ids, so the frontmatter `name` line is the one line left out.
  const unnamed = (files: SkillFiles): SkillFiles => ({
    ...files,
    'SKILL.md': files['SKILL.md'].replace(/^name: .*\n/m, ''),
  });

  it('completes the recorded step from the recorded pack into the skill context-mill published', () => {
    const pair = JSON.parse(
      fs.readFileSync(path.join(root, 'pair.json'), 'utf8'),
    ) as { product: string };

    const composed = composeStepSkill(
      tree(path.join(root, 'step')),
      tree(path.join(root, 'pack')),
      pair.product,
    );

    expect(unnamed(composed)).toEqual(
      unnamed(tree(path.join(root, 'completed'))),
    );
  });
});
