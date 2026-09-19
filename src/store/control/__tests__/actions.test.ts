import { describe, expect, it } from 'vitest';
import { ERROR_TRACKING_PROJECT_PATH_KEY } from '../../programs/error-tracking/detect-agentic.js';
import { SOURCE_MAPS_CONTEXT_KEYS } from '../../programs/error-tracking-upload-source-maps/detect.js';
import { flowFor } from '../../programs/flow-for.js';
import { Program, PROGRAM_REGISTRY } from '../../programs/program-registry.js';
import { SELF_DRIVING_INTEGRATE_PATH_KEY } from '../../programs/self-driving/detect.js';
import {
  buildSession,
  McpOutcome,
  ScanConsent,
} from '../../session/wizard-session.js';
import type { Flow } from '../../state/flow.js';
import { Interrupt } from '../../state/interrupts.js';
import { WizardStore } from '../../state/store.js';
import { createControlledStore, createTestStore } from '../../testing/index.js';
import { setUI } from '../../ui/index.js';
import { StoreUI } from '../../ui/store-ui.js';
import {
  actionsFor,
  GENERIC_ACTIONS,
  NO_ACTION_SCREENS,
  UnknownActionError,
} from '../actions.js';
import { BadParamError, MissingParamError } from '../params.js';
import { ControlDriver } from '../driver.js';

function storeFor(program = Program.PostHogIntegration): WizardStore {
  const store = createTestStore(program);
  setUI(new StoreUI(store));
  store.session = buildSession({
    installDir: '/tmp/control-actions',
    ci: true,
  });
  return store;
}

function apply(store: WizardStore, screen: string, id: string, params = {}) {
  const action = actionsFor(store.flow, screen).find((a) => a.id === id);
  if (!action) throw new Error(`no ${id} on ${screen}`);
  action.apply(store, params);
}

describe('generic actions', () => {
  it('every intro confirms setup', () => {
    for (const screen of ['intro', 'audit-intro', 'self-driving-intro']) {
      const store = storeFor();
      apply(store, screen, 'confirm_setup');
      expect(store.session.setupConfirmed).toBe(true);
    }
  });

  it.each([
    [
      'health-check',
      'dismiss_outage',
      {},
      (s: WizardStore) => s.session.outageDismissed === true,
    ],
    [
      'setup',
      'choose',
      { key: 'router', value: 'app' },
      (s: WizardStore) => s.session.frameworkContext.router === 'app',
    ],
    [
      'outro',
      'dismiss_outro',
      {},
      (s: WizardStore) => s.session.outroDismissed,
    ],
    [
      'audit-outro',
      'dismiss_outro',
      {},
      (s: WizardStore) => s.session.outroDismissed,
    ],
    [
      'source-maps-outro',
      'dismiss_outro',
      {},
      (s: WizardStore) => s.session.outroDismissed,
    ],
    [
      'mint-failure',
      'continue_setup',
      {},
      (s: WizardStore) => s.session.mintHandoff === 'continue',
    ],
    [
      'mint-failure',
      'dismiss_outro',
      {},
      (s: WizardStore) => s.session.mintHandoff === 'exit',
    ],
    [
      'mcp',
      'set_mcp_outcome',
      { outcome: 'installed', clients: ['cursor'] },
      (s: WizardStore) =>
        s.session.mcpComplete &&
        s.session.mcpOutcome === McpOutcome.Installed &&
        s.session.mcpInstalledClients[0] === 'cursor',
    ],
    [
      'mcp-add',
      'set_mcp_outcome',
      { outcome: 'skipped' },
      (s: WizardStore) => s.session.mcpOutcome === McpOutcome.Skipped,
    ],
    [
      'mcp-remove',
      'set_mcp_outcome',
      {},
      (s: WizardStore) => s.session.mcpOutcome === McpOutcome.Skipped,
    ],
    [
      'mcp-suggested-prompts',
      'dismiss',
      {},
      (s: WizardStore) => s.session.mcpSuggestedPromptsDismissed,
    ],
    [
      'slack-connect',
      'dismiss_slack',
      {},
      (s: WizardStore) => s.session.slackStepDismissed,
    ],
    [
      'slack-connect',
      'set_slack_connected',
      { connected: true },
      (s: WizardStore) => s.session.slackConnected === true,
    ],
    [
      'keep-skills',
      'keep_skills',
      { kept: false },
      (s: WizardStore) => s.session.skillsComplete,
    ],
  ] as const)(
    '%s / %s commits through its setter',
    (screen, id, params, check) => {
      const store = storeFor();
      apply(store, screen, id, params);
      expect(check(store)).toBe(true);
    },
  );

  it('answers and cancels a pending wizard_ask', async () => {
    const store = storeFor();
    const asked = store.requestQuestion({
      id: 'q',
      subject: 'test',
      questions: [{ id: 'color', question: 'Which?', kind: 'text' }],
    } as never);
    apply(store, Interrupt.WizardAsk, 'answer_question', {
      answers: { color: 'red' },
    });
    await expect(asked).resolves.toEqual({ color: 'red' });

    const cancelled = store.requestQuestion({
      id: 'q2',
      subject: 'test',
      questions: [{ id: 'size', question: 'How big?', kind: 'text' }],
    } as never);
    apply(store, Interrupt.WizardAsk, 'cancel_question');
    await expect(cancelled).resolves.toEqual({ size: '__cancelled__' });
  });

  it('resolves a task notice, defaulting to keep', async () => {
    const store = storeFor();
    const kept = store.showTaskNotice({
      title: 't',
      items: [],
      prompt: 'p',
    } as never);
    apply(store, Interrupt.TaskNotice, 'resolve_notice');
    await expect(kept).resolves.toBe(true);
    const skipped = store.showTaskNotice({
      title: 't',
      items: [],
      prompt: 'p',
    } as never);
    apply(store, Interrupt.TaskNotice, 'resolve_notice', { keep: false });
    await expect(skipped).resolves.toBe(false);
  });

  it('resolves the port conflict and the manual auth code overlays', async () => {
    const store = storeFor();
    void store.showPortConflict({
      command: 'x',
      pid: '1',
      port: 8010,
      user: 'u',
    });
    expect(store.hasInterrupt).toBe(true);
    apply(store, Interrupt.PortConflict, 'resolve_port_conflict');
    expect(store.hasInterrupt).toBe(false);

    const code = store.waitForManualAuthCode();
    store.showManualAuthCode();
    apply(store, Interrupt.ManualAuthCode, 'submit_auth_code', { code: 'abc' });
    await expect(code).resolves.toBe('abc');
    store.showManualAuthCode();
    apply(store, Interrupt.ManualAuthCode, 'dismiss_auth_code');
    expect(store.hasInterrupt).toBe(false);
  });

  it('backs up and fixes a settings override through the store callback', async () => {
    const store = storeFor();
    const fix = vi.fn(() => true);
    const settled = store.showSettingsOverride(
      [
        {
          source: 'project',
          writable: true,
          keys: ['apiKeyHelper'],
          path: '/p',
        },
      ] as never,
      fix,
    );
    apply(store, Interrupt.SettingsOverride, 'backup_and_fix');
    expect(fix).toHaveBeenCalledTimes(1);
    await expect(settled).resolves.toBeUndefined();
  });

  it('rejects a missing required param', () => {
    const store = storeFor();
    expect(() => apply(store, 'setup', 'choose', { key: 'router' })).toThrow(
      MissingParamError,
    );
    expect(() =>
      apply(store, Interrupt.ManualAuthCode, 'submit_auth_code', {}),
    ).toThrow(MissingParamError);
  });
});

describe('program actions', () => {
  it('self-driving picks the integration target and answers its check', () => {
    const store = storeFor(Program.SelfDriving);
    apply(store, 'self-driving-integration-check', 'set_integrate', {
      integrate: true,
    });
    expect(store.session.integrate).toBe(true);
    apply(store, 'self-driving-integration-detect', 'pick_integration_target', {
      path: 'apps/web',
      integration: 'nextjs',
    });
    expect(
      store.session.frameworkContext[SELF_DRIVING_INTEGRATE_PATH_KEY],
    ).toBe('apps/web');
    expect(store.session.integration).toBe('nextjs');
    apply(store, 'self-driving-handoff', 'confirm_self_driving_handoff');
    expect(store.session.selfDrivingHandoffConfirmed).toBe(true);
    apply(store, 'self-driving-github', 'set_github_connected', {
      connected: true,
    });
    expect(store.session.githubConnected).toBe(true);
  });

  it('self-driving declines GitHub with the required-connection outro', () => {
    const store = storeFor(Program.SelfDriving);
    apply(store, 'self-driving-github', 'decline_github');
    expect(store.session.githubDeclined).toBe(true);
    expect(store.session.outroData?.kind).toBe('cancel');
  });

  it('error-tracking picks the project the run is scoped to', () => {
    const store = storeFor(Program.ErrorTracking);
    apply(store, 'error-tracking-detect', 'pick_integration_target', {
      path: '.',
      integration: 'django',
    });
    expect(
      store.session.frameworkContext[ERROR_TRACKING_PROJECT_PATH_KEY],
    ).toBe('.');
    expect(store.session.integration).toBe('django');
  });

  it('rejects an unknown framework id', () => {
    const store = storeFor(Program.ErrorTracking);
    expect(() =>
      apply(store, 'error-tracking-detect', 'pick_integration_target', {
        path: '.',
        integration: 'cobol',
      }),
    ).toThrow(BadParamError);
  });

  it('source-maps commits the pick the detect screen would', () => {
    const store = storeFor(Program.ErrorTrackingUploadSourceMaps);
    apply(store, 'source-maps-detect', 'pick_source_maps_project', {
      variant: 'node',
      path: '.',
    });
    const ctx = store.session.frameworkContext;
    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.selectedVariant]).toBe('node');
    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.selectedPath]).toBe('.');
    expect(typeof ctx[SOURCE_MAPS_CONTEXT_KEYS.selectedDisplayName]).toBe(
      'string',
    );
    expect(() =>
      apply(store, 'source-maps-detect', 'pick_source_maps_project', {
        variant: 'node',
      }),
    ).toThrow(MissingParamError);
  });

  it('a program action wins over a generic one with the same id', () => {
    const own = {
      id: 'confirm_setup',
      description: 'own',
      apply: () => undefined,
    };
    const flow: Flow = {
      programId: Program.PostHogIntegration,
      skillId: null,
      steps: [
        {
          id: 'intro',
          label: 'Intro',
          screenId: 'intro',
          controlActions: [own],
        },
      ],
    };
    const actions = actionsFor(flow, 'intro');
    expect(actions.map((a) => a.id)).toEqual(['confirm_setup']);
    expect(actions[0]).toBe(own);
  });
});

describe('param validation', () => {
  it('confirm_setup on the default intro follows the sharing toggle like Enter does', () => {
    // An interactive session starts undecided; a ci session is granted up front.
    const undecided = createControlledStore(undefined, { ci: false });
    expect(undecided.session.scanConsent).toBe(ScanConsent.Undecided);
    apply(undecided, 'intro', 'confirm_setup');
    expect(undecided.session.scanConsent).toBe(ScanConsent.Granted);
    expect(undecided.session.setupConfirmed).toBe(true);

    const declined = createControlledStore(undefined, { ci: false });
    declined.declineSharing();
    apply(declined, 'intro', 'confirm_setup');
    expect(declined.session.scanConsent).toBe(ScanConsent.Declined);

    const explicit = storeFor();
    apply(explicit, 'intro', 'confirm_setup', { share: false });
    expect(explicit.session.scanConsent).toBe(ScanConsent.Declined);
    expect(() =>
      apply(storeFor(), 'intro', 'confirm_setup', { share: 'yes' }),
    ).toThrow(BadParamError);

    const other = createControlledStore(Program.Audit, { ci: false });
    apply(other, 'audit-intro', 'confirm_setup');
    expect(other.session.scanConsent).toBe(ScanConsent.Undecided);
    expect(other.session.setupConfirmed).toBe(true);
  });

  it('passes booleans through and rejects anything else', () => {
    const store = storeFor();
    const skills = vi.spyOn(store, 'setSkillsComplete');
    apply(store, 'keep-skills', 'keep_skills', { kept: false });
    expect(skills).toHaveBeenCalledWith(false);
    apply(store, 'slack-connect', 'set_slack_connected', { connected: false });
    expect(store.session.slackConnected).toBe(false);
    expect(() =>
      apply(store, 'slack-connect', 'set_slack_connected', {
        connected: 'false',
      }),
    ).toThrow(BadParamError);
    expect(() =>
      apply(store, 'keep-skills', 'keep_skills', { kept: 1 }),
    ).toThrow(BadParamError);
  });

  it('rejects an unknown MCP outcome and a non-string client list', () => {
    const store = storeFor();
    expect(() =>
      apply(store, 'mcp', 'set_mcp_outcome', { outcome: 'maybe' }),
    ).toThrow(BadParamError);
    expect(() =>
      apply(store, 'mcp', 'set_mcp_outcome', { clients: [1] }),
    ).toThrow(BadParamError);
    expect(store.session.mcpComplete).toBe(false);
  });

  it('requires an answers object and a non-empty string value', () => {
    const store = storeFor();
    void store.requestQuestion({
      id: 'q',
      subject: 'test',
      questions: [{ id: 'color', question: 'Which?', kind: 'text' }],
    } as never);
    expect(() =>
      apply(store, Interrupt.WizardAsk, 'answer_question', { answers: 'red' }),
    ).toThrow(MissingParamError);
    expect(() =>
      apply(store, 'setup', 'choose', { key: 'router', value: '' }),
    ).toThrow(MissingParamError);
  });
});

describe('coverage', () => {
  it('every flow key and interrupt is actionable or explicitly no-action', () => {
    const missing: string[] = [];
    for (const config of PROGRAM_REGISTRY) {
      const { flow } = flowFor(config.id);
      for (const step of flow.steps) {
        if (!step.screenId) continue;
        if (
          actionsFor(flow, step.screenId).length === 0 &&
          !NO_ACTION_SCREENS.has(step.screenId)
        ) {
          missing.push(`${config.id}:${step.screenId}`);
        }
      }
    }
    for (const interrupt of Object.values(Interrupt)) {
      if (!(interrupt in GENERIC_ACTIONS) && !NO_ACTION_SCREENS.has(interrupt))
        missing.push(interrupt);
    }
    expect(missing).toEqual([]);
  });

  it('no screen is both actionable and no-action', () => {
    const both = [...NO_ACTION_SCREENS].filter((s) => s in GENERIC_ACTIONS);
    expect(both).toEqual([]);
  });

  it('the driver rejects an action the current screen does not offer', () => {
    const store = storeFor();
    const driver = new ControlDriver(store);
    expect(() => driver.performAction('keep_skills')).toThrow(
      UnknownActionError,
    );
    expect(driver.performAction('confirm_setup').session.setupConfirmed).toBe(
      true,
    );
  });
});
