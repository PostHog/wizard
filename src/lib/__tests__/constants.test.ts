import { WIZARD_USER_AGENT, wizardUserAgentForProgram } from '@lib/constants';

describe('wizardUserAgentForProgram', () => {
  it('tags the program so the backend can attribute created_via (self-driving → self_driving)', () => {
    const ua = wizardUserAgentForProgram('self-driving');
    // The backend upgrade keys on both the base wizard token and /program:\s*self-driving/
    // (posthog `is_wizard_self_driving_program`). Keep this literal in sync with that regex.
    expect(ua).toContain('posthog/wizard');
    expect(ua).toMatch(/program:\s*self-driving/);
  });

  it('returns the base user-agent unchanged when no program is given', () => {
    expect(wizardUserAgentForProgram()).toBe(WIZARD_USER_AGENT);
  });
});
