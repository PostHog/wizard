import { createSkillInstallTracker } from '@lib/agent/skill-install-tracker';

describe('createSkillInstallTracker', () => {
  it('reports nothing when no install was attempted', () => {
    const tracker = createSkillInstallTracker();
    expect(tracker.continuedWithoutSkill()).toBeUndefined();
  });

  it('reports nothing when the install succeeded', () => {
    const tracker = createSkillInstallTracker();
    tracker.recordSuccess();
    expect(tracker.continuedWithoutSkill()).toBeUndefined();
  });

  it('reports the failure detail when the run never got a skill', () => {
    const tracker = createSkillInstallTracker();
    tracker.recordFailure('integration-nextjs-app-router: download-failed');
    expect(tracker.continuedWithoutSkill()).toBe(
      'integration-nextjs-app-router: download-failed',
    );
  });

  it('joins repeated failures', () => {
    const tracker = createSkillInstallTracker();
    tracker.recordFailure('integration-nextjs: skill-not-found');
    tracker.recordFailure('integration-nextjs-app-router: download-failed');
    expect(tracker.continuedWithoutSkill()).toBe(
      'integration-nextjs: skill-not-found; integration-nextjs-app-router: download-failed',
    );
  });

  it('a later success clears earlier failures — the run has a skill', () => {
    const tracker = createSkillInstallTracker();
    tracker.recordFailure('integration-nextjs: skill-not-found');
    tracker.recordSuccess();
    expect(tracker.continuedWithoutSkill()).toBeUndefined();
  });
});
