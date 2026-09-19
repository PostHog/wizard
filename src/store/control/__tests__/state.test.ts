import { describe, expect, it } from 'vitest';
import {
  buildSession,
  OutroKind,
  RunPhase,
} from '../../session/wizard-session.js';
import { createTestStore } from '../../testing/index.js';
import { setUI } from '../../ui/index.js';
import { StoreUI } from '../../ui/store-ui.js';
import {
  contextDigest,
  projectState,
  redactContext,
  runResult,
} from '../state.js';

const RUN = { status: 'idle' as const, error: null };

describe('projectState', () => {
  it('never carries a credential, an api key, a user, or a vaulted answer', () => {
    const store = createTestStore();
    setUI(new StoreUI(store));
    store.session = buildSession({
      installDir: '/tmp/control-state',
      ci: true,
      apiKey: 'phx_PERSONAL_SECRET',
    });
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

    const state = projectState(store, RUN);
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
    expect(state.frameworkContext.values).toEqual({
      router: 'app',
      'upload-api-key': '[redacted]',
      answer: '[secret-ref]',
    });
    expect(state.frameworkContext.keys).toEqual([
      'answer',
      'router',
      'upload-api-key',
    ]);
    expect(state.frameworkContext.digest).toBe(
      contextDigest(store.session.frameworkContext),
    );
  });

  it('projects the screen, its actions, and the version', () => {
    const store = createTestStore();
    setUI(new StoreUI(store));
    store.session = buildSession({
      installDir: '/tmp/control-state',
      ci: true,
    });
    const before = projectState(store, RUN);
    expect(before.currentScreen).toBe('intro');
    expect(before.actions.map((a) => a.id)).toEqual(['confirm_setup']);
    expect(before.hasOverlay).toBe(false);
    store.completeSetup();
    const after = projectState(store, { status: 'running', error: null });
    expect(after.version).toBeGreaterThan(before.version);
    expect(after.session.setupConfirmed).toBe(true);
    expect(after.run).toEqual({ status: 'running', error: null });
  });

  it('reduces the outro and reports the run result', () => {
    const store = createTestStore();
    setUI(new StoreUI(store));
    store.session = buildSession({
      installDir: '/tmp/control-state',
      ci: true,
    });
    store.setOutroData({
      kind: OutroKind.Error,
      message: 'boom',
      body: 'long body copy',
      errorCode: 'PHW_INTERNAL_UNHANDLED' as never,
    });
    store.setDashboardUrl('https://us.posthog.com/project/1/dashboard/2');
    store.setRunPhase(RunPhase.Error);
    const result = runResult(store);
    expect(result).toEqual({
      runPhase: RunPhase.Error,
      outroData: {
        kind: OutroKind.Error,
        errorCode: 'PHW_INTERNAL_UNHANDLED',
        message: 'boom',
      },
      dashboardUrl: 'https://us.posthog.com/project/1/dashboard/2',
      notebookUrl: null,
      handoffText: null,
    });
    expect(JSON.stringify(projectState(store, RUN))).not.toContain(
      'long body copy',
    );
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
