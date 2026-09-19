import { HostResolution } from '../../host-resolution.js';
import { OutroKind, RunPhase } from '../../session/wizard-session.js';
import { createControlledStore, expectNoSecrets } from '../../testing/index.js';
import { actionsFor, toActionView } from '../actions.js';
import {
  CONTROL_SESSION_KEYS,
  isSecretKey,
  projectState,
  redactContext,
} from '../state.js';

const US = HostResolution.fromApiHost('https://us.posthog.com');

describe('the control state projection', () => {
  it('never carries a credential, an api key, a user, or a vaulted answer', () => {
    const store = createControlledStore(undefined, {
      apiKey: 'phx_PERSONAL_SECRET',
    });
    store.setCredentials({
      accessToken: 'phx_ACCESS_SECRET',
      projectApiKey: 'phc_PROJECT_TOKEN',
      host: US,
      projectId: 42,
    });
    store.setApiUser({
      email: 'someone@example.com',
      uuid: 'user-uuid',
    } as never);
    store.setFrameworkContext('router', 'app');
    store.setFrameworkContext('upload-api-key', 'phs_UPLOAD_SECRET');
    store.setFrameworkContext(
      'answer',
      'secret:0b7c6d2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    );

    const state = projectState(store);
    expectNoSecrets(JSON.stringify(state), [
      'someone@example.com',
      'user-uuid',
    ]);
    expect(state.session.hasCredentials).toBe(true);
    expect(state.session.projectId).toBe(42);
    expect(state.session.frameworkContext).toEqual({
      router: 'app',
      'upload-api-key': '[redacted]',
      answer: '[secret-ref]',
    });
  });

  it('projects exactly the listed session keys plus the two credential facts', () => {
    const state = projectState(createControlledStore());
    expect(Object.keys(state.session).sort()).toEqual(
      [...CONTROL_SESSION_KEYS, 'hasCredentials', 'projectId'].sort(),
    );
    expect(Object.keys(state).sort()).toEqual(
      [
        'actions',
        'currentScreen',
        'eventPlan',
        'handoffText',
        'session',
        'setupQuestions',
        'statusMessages',
        'tasks',
        'version',
      ].sort(),
    );
  });

  it('mirrors the store: the listed session fields, the run atoms, the screen', () => {
    const store = createControlledStore();
    store.completeSetup();
    store.setTasks([
      { label: 'Install SDK', status: 'in_progress', done: false } as never,
    ]);
    store.pushStatus('installing the SDK');
    store.setEventPlan([{ name: 'signup', description: 'a user signed up' }]);
    store.setHandoffText('run this prompt');
    store.setDashboardUrl('https://us.posthog.com/project/1/dashboard/2');
    store.setOutroData({
      kind: OutroKind.Success,
      message: 'ok',
      body: 'long body copy',
    });
    store.setRunPhase(RunPhase.Completed);

    const state = projectState(store);
    for (const key of CONTROL_SESSION_KEYS) {
      if (key === 'frameworkContext') continue;
      expect(state.session[key], key).toEqual(store.session[key]);
    }
    expect(state.currentScreen).toBe(store.currentScreen);
    expect(state.version).toBe(store.getVersion());
    expect(state.tasks).toEqual([
      { label: 'Install SDK', status: 'in_progress', done: false },
    ]);
    expect(state.statusMessages).toEqual(['installing the SDK']);
    expect(state.eventPlan).toEqual([
      { name: 'signup', description: 'a user signed up' },
    ]);
    expect(state.handoffText).toBe('run this prompt');
    expect(state.actions).toEqual(
      actionsFor(store.flow, store.currentScreen).map(toActionView),
    );
    expect(JSON.stringify(state)).not.toContain('"apply"');
  });

  it('offers the screen actions without their closures and with their params', () => {
    const store = createControlledStore();
    expect(projectState(store).currentScreen).toBe('intro');
    expect(projectState(store).actions).toMatchObject([
      { id: 'confirm_setup', params: { share: 'boolean (optional)' } },
    ]);
    expect(projectState(store).actions[0]).not.toHaveProperty('apply');
    const before = projectState(store).version;
    store.completeSetup();
    const after = projectState(store);
    expect(after.version).toBeGreaterThan(before);
    expect(after.session.setupConfirmed).toBe(true);
  });

  it('lists only the setup questions the session has not answered', () => {
    const store = createControlledStore();
    store.setFrameworkConfig(
      'nextjs' as never,
      {
        metadata: {
          setup: {
            questions: [
              {
                key: 'router',
                message: 'Which router?',
                options: [{ label: 'App', value: 'app' }],
                detect: () => Promise.resolve(null),
              },
              {
                key: 'styling',
                message: 'Which styling?',
                options: [{ label: 'CSS', value: 'css', hint: 'plain' }],
                detect: () => Promise.resolve(null),
              },
            ],
          },
        },
      } as never,
    );
    expect(projectState(store).setupQuestions.map((q) => q.key)).toEqual([
      'router',
      'styling',
    ]);
    store.setFrameworkContext('router', 'app');
    expect(projectState(store).setupQuestions).toEqual([
      {
        key: 'styling',
        message: 'Which styling?',
        options: [{ label: 'CSS', value: 'css', hint: 'plain' }],
      },
    ]);
  });

  it('keeps only the allow-listed outro error detail', () => {
    const store = createControlledStore();
    store.setOutroData({
      kind: OutroKind.Error,
      message: 'boom',
      errorDetail: {
        reason: 'no manifest',
        response: { headers: { authorization: 'Bearer phx_LEAK' } },
      },
    });
    expect(projectState(store).session.outroData).toEqual({
      kind: OutroKind.Error,
      message: 'boom',
      errorDetail: { reason: 'no manifest' },
    });
  });

  it('redacts secret-named keys and secret refs, and nothing else', () => {
    expect(
      redactContext({
        a: 1,
        token: 'x',
        apiKey: 'y',
        ACCESS_TOKEN: 'z',
        nested: { k: 'v' },
        ref: 'secret:abcdef0123456789',
        short: 'secret:abc',
        monkey: 'business',
        keyboard: 'qwerty',
      }),
    ).toEqual({
      a: 1,
      token: '[redacted]',
      apiKey: '[redacted]',
      ACCESS_TOKEN: '[redacted]',
      nested: { k: 'v' },
      ref: '[secret-ref]',
      short: 'secret:abc',
      monkey: 'business',
      keyboard: 'qwerty',
    });
    expect(isSecretKey('upload-api-key')).toBe(true);
    expect(isSecretKey('projectApiKey')).toBe(true);
    expect(isSecretKey('hotkeys')).toBe(false);
  });
});
