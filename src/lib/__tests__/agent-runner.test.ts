import { extractInstalledSkillId } from '../agent-runner';

describe('extractInstalledSkillId', () => {
  it('extracts the installed skill id from bootstrap output', () => {
    const output = `
Bootstrap complete.
[WIZARD-SKILL-ID] integration-nextjs-app-router
Waiting for next queued step.
`;

    expect(extractInstalledSkillId(output)).toBe(
      'integration-nextjs-app-router',
    );
  });

  it('returns null when the marker is missing', () => {
    expect(extractInstalledSkillId('No marker present')).toBeNull();
  });
});
