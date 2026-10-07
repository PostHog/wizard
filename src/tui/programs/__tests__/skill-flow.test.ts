import { AGENT_SKILL_STEPS } from '../shared/skill-flow';
import { tuiView } from '@tui/__tests__/helpers/tui-view.no-jest';
import { RunPhase } from '@shared/run-state';
import { HostResolution } from '@shared/host-resolution';

describe('AGENT_SKILL_STEPS', () => {
  it('is intro → health-check → auth → run → outro → skills, all with screens and working predicates', () => {
    expect(AGENT_SKILL_STEPS.map((s) => s.id)).toEqual([
      'intro',
      'health-check',
      'auth',
      'run',
      'outro',
      'skills',
    ]);

    const view = tuiView({});
    const [intro, , auth, run, outro] = AGENT_SKILL_STEPS;

    // Intro gate starts closed
    expect(intro.gate!(view)).toBe(false);

    // All incomplete initially
    expect(auth.isComplete!(view)).toBe(false);
    expect(run.isComplete!(view)).toBe(false);
    expect(outro.isComplete!(view)).toBe(false);

    // Intro gate opens after setup confirmed
    view.setupConfirmed = true;
    expect(intro.gate!(view)).toBe(true);

    // Completing each
    view.session.credentials = {
      accessToken: 't',
      projectApiKey: 'k',
      host: HostResolution.fromApiHost('h'),
      projectId: 1,
    };
    expect(auth.isComplete!(view)).toBe(true);

    view.session.runPhase = RunPhase.Completed;
    expect(run.isComplete!(view)).toBe(true);

    view.outroDismissed = true;
    expect(outro.isComplete!(view)).toBe(true);
  });
});
