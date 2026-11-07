import { SessionStore } from '../session-store';
import { buildSession } from '../wizard-session';

const tags = vi.hoisted(() => ({} as Record<string, unknown>));

vi.mock('@utils/analytics.js', () => ({
  analytics: {
    setTag: vi.fn((key: string, value: unknown) => {
      tags[key] = value;
    }),
  },
  sessionProperties: vi.fn(() => ({})),
}));

function runSkills(...skillIds: (string | null)[]) {
  const store = new SessionStore(buildSession({}));
  for (const skillId of skillIds) store.setSkillId(skillId);
}

describe('migrated_from', () => {
  beforeEach(() => {
    for (const key of Object.keys(tags)) delete tags[key];
  });

  it('tags a run of an email migration skill with the provider it moves from', () => {
    runSkills('migrate-email-resend');

    expect(tags.migrated_from).toBe('resend');
  });

  it('leaves a run of any other skill without the tag', () => {
    runSkills('migrate-statsig');

    expect(tags.migrated_from).toBeUndefined();
  });

  it.each([['migrate-statsig'], [null]])(
    'drops the tag when the run moves on from an email migration to %s',
    (nextSkillId) => {
      runSkills('migrate-email-resend', nextSkillId);

      expect(tags.migrated_from).toBeUndefined();
    },
  );
});
