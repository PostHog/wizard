import { resolveSkillEntry } from '@ui/tui/screens/SkillSourceInfo';
import type { SkillEntry } from '@lib/wizard-tools';

const entry = (id: string): SkillEntry =>
  ({ id, downloadUrl: `https://example.com/${id}.tar.gz` } as SkillEntry);

const MENU: SkillEntry[] = [
  entry('audit'),
  entry('integration-python'),
  entry('integration-django'),
  entry('integration-nextjs-app-router'),
  entry('integration-nextjs-pages-router'),
  entry('integration-vue-3'),
];

describe('resolveSkillEntry', () => {
  it('matches exact ids (named programs like audit)', () => {
    expect(resolveSkillEntry(MENU, 'audit')?.id).toBe('audit');
  });

  it('matches raw integration ids against integration-<id> entries', () => {
    expect(resolveSkillEntry(MENU, 'python')?.id).toBe('integration-python');
  });

  it('matches a unique integration-<id>-* variant', () => {
    expect(resolveSkillEntry(MENU, 'vue')?.id).toBe('integration-vue-3');
  });

  it('returns null for ambiguous variants rather than guessing', () => {
    // nextjs has app-router and pages-router variants — which one is
    // right depends on the project, so don't pick arbitrarily.
    expect(resolveSkillEntry(MENU, 'nextjs')).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(resolveSkillEntry(MENU, 'cobol')).toBeNull();
  });
});
