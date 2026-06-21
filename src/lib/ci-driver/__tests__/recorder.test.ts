/**
 * Recorder unit test: the key-moment capture logic. (Frame *rendering* is
 * validated via tsx — jest globally mocks `ink` — see replay.ts.)
 */

import { WizardStore } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui/index';
import { buildSession, RunPhase } from '@lib/wizard-session';
import { Integration } from '@lib/constants';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import { WizardReadiness } from '@lib/health-checks/readiness';
import { Program } from '@lib/programs/program-registry';
import { ScreenId } from '@ui/tui/router';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration';
import { WizardCiDriver } from '../wizard-ci-driver';
import { decideE2eAction, DEFAULT_E2E_PROFILE } from '../e2e-profile';
import { WizardRecorder } from '../recorder';

function recordedRun() {
  const store = new WizardStore(Program.PostHogIntegration);
  setUI(new InkUI(store));
  const session = buildSession({ installDir: '/tmp/rec', ci: true });
  session.integration = Integration.nextjs;
  session.frameworkConfig = FRAMEWORK_REGISTRY[Integration.nextjs];
  store.session = session;

  let clock = 0;
  const rec = new WizardRecorder(
    store,
    { program: 'posthog-integration', app: 'demo' },
    () => (clock += 500),
  );
  rec.start();

  const driver = new WizardCiDriver(store);
  const profile = posthogIntegrationConfig.e2e ?? DEFAULT_E2E_PROFILE;
  for (let i = 0; i < 40; i++) {
    const state = driver.readState();
    const d = decideE2eAction(state, profile);
    if (d.action) driver.performAction(d.action.id, d.action.params ?? {});
    if (state.currentScreen === ScreenId.HealthCheck) {
      store.setReadinessResult({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });
    } else if (state.currentScreen === ScreenId.Auth) {
      store.setCredentials({
        accessToken: 'phx_topsecret',
        projectApiKey: 'phc_x',
        host: 'https://us.posthog.com',
        projectId: 1,
      });
    } else if (state.currentScreen === ScreenId.Run) {
      store.pushStatus('Installing posthog-js…');
      store.setTasks([
        { label: 'Install SDK', status: 'completed' as never, done: true },
      ]);
      store.setRunPhase(RunPhase.Completed);
    }
    if (d.done || store.session.skillsComplete) break;
  }
  rec.stop();
  return rec.getRecording();
}

describe('WizardRecorder', () => {
  it('captures a frame at each key moment, labelled by trigger', () => {
    const rec = recordedRun();
    const triggers = rec.frames.map((f) => f.triggers.join('+'));

    // First frame is the initial snapshot; every route lands a 'screen' frame.
    expect(triggers[0]).toBe('start');
    expect(rec.frames.map((f) => f.screen)).toEqual(
      expect.arrayContaining([
        ScreenId.Intro,
        ScreenId.HealthCheck,
        ScreenId.Setup,
        ScreenId.Auth,
        ScreenId.Run,
        ScreenId.Outro,
        ScreenId.Mcp,
        ScreenId.SlackConnect,
        ScreenId.KeepSkills,
      ]),
    );
    // Task + status updates during the run are their own key moments.
    expect(triggers).toContain('tasks');
    expect(triggers).toContain('status');
    // Frames carry monotonic timestamps.
    expect(rec.frames.map((f) => f.ms)).toEqual(
      [...rec.frames.map((f) => f.ms)].sort((a, b) => a - b),
    );
  });

  it('redacts the access token from the recording', () => {
    const rec = recordedRun();
    expect(JSON.stringify(rec)).not.toContain('phx_topsecret');
    const authed = rec.frames.find((f) => f.session.credentials);
    expect(authed?.session.credentials?.accessToken).toBe('phx_***redacted***');
  });
});
