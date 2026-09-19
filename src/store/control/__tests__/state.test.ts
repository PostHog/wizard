import { describe, expect, it } from 'vitest';
import {
  buildSession,
  OutroKind,
  RunPhase,
} from '../../session/wizard-session.js';
import { createTestStore } from '../../testing/index.js';
import { setUI } from '../../ui/index.js';
import { StoreUI } from '../../ui/store-ui.js';
import { actionsFor, toActionView } from '../actions.js';
import { CONTROL_SESSION_KEYS, projectState, redactContext } from '../state.js';

function storeFor(over: { apiKey?: string } = {}) {
  const store = createTestStore();
  setUI(new StoreUI(store));
  store.session = buildSession({
    installDir: '/tmp/control-state',
    ci: true,
    ...over,
  });
  return store;
}

describe('projectState', () => {
  it('never carries a credential, an api key, a user, or a vaulted answer', () => {
    const store = storeFor({ apiKey: 'phx_PERSONAL_SECRET' });
    store.setCredentials({
      accessToken: 'phx_ACCESS_SECRET',
      projectApiKey: 'phc_PROJECT_TOKEN',
      host: {} as never,
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
    const text = JSON.stringify(state);
    for (const leak of [
      'phx_',
      'phc_',
      'phs_',
      'secret:0b7c',
      'someone@example.com',
      'user-uuid',
    ]) {
      expect(text, leak).not.toContain(leak);
    }
    expect(state.session.hasCredentials).toBe(true);
    expect(state.session.projectId).toBe(42);
    expect(state.session.frameworkContext).toEqual({
      router: 'app',
      'upload-api-key': '[redacted]',
      answer: '[secret-ref]',
    });
  });

  it('mirrors the store: the listed session fields, the run atoms, the screen', () => {
    const store = storeFor();
    store.completeSetup();
    store.setTasks([
      { label: 'Install SDK', status: 'in_progress', done: false } as never,
    ]);
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
    expect(state.tasks).toEqual(store.tasks);
    expect(state.statusMessages).toEqual(store.statusMessages);
    expect(state.eventPlan).toEqual(store.eventPlan);
    expect(state.handoffText).toBe('run this prompt');
    expect(state.actions).toEqual(
      actionsFor(store.flow, store.currentScreen).map(toActionView),
    );
    expect(JSON.stringify(state)).not.toContain('"apply"');
  });

  it('bumps the version on a commit and offers the screen actions', () => {
    const store = storeFor();
    const before = projectState(store);
    expect(before.currentScreen).toBe('intro');
    expect(before.actions.map((a) => a.id)).toEqual(['confirm_setup']);
    store.completeSetup();
    const after = projectState(store);
    expect(after.version).toBeGreaterThan(before.version);
    expect(after.session.setupConfirmed).toBe(true);
  });

  it('redacts by key and by secret ref only', () => {
    expect(
      redactContext({
        a: 1,
        token: 'x',
        nested: { k: 'v' },
        ref: 'secret:abcdef0123456789',
      }),
    ).toEqual({
      a: 1,
      token: '[redacted]',
      nested: { k: 'v' },
      ref: '[secret-ref]',
    });
  });
});
