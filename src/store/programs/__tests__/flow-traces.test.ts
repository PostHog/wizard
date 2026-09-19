/**
 * Golden screen sequences and `screen <name>` analytics per program, produced
 * by walking each program's steps through the store with a generic advance per
 * screen. Baseline for the surface split: must stay byte identical.
 */
import { FlowStore, RunPhase, McpOutcome } from '../../state/store.js';
import { StoreUI } from '@store/ui/store-ui';
import { setUI } from '../../ui/index.js';
import {
  buildSession,
  OutroKind,
  type WizardSession,
} from '../../session/wizard-session.js';
import { Integration } from '../../shared/constants.js';
import { FRAMEWORK_REGISTRY } from '../../registry.js';
import { HostResolution } from '../../host-resolution.js';
import { WizardReadiness } from '../../health-checks/readiness.js';
import { analytics } from '../../shared/analytics.js';
import {
  PROGRAM_REGISTRY,
  getProgramConfig,
  type ProgramId,
} from '../program-registry.js';
import { SELF_DRIVING_INTEGRATE_PATH_KEY } from '../self-driving/detect.js';
import { ERROR_TRACKING_PROJECT_PATH_KEY } from '../error-tracking/detect-agentic.js';
import { SOURCE_MAPS_CONTEXT_KEYS } from '../error-tracking-upload-source-maps/detect.js';
import { flowFor } from '../flow-for.js';

vi.mock('../../shared/analytics.js', () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    captureException: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  sessionProperties: vi.fn(() => ({})),
}));

const wizardCapture = analytics.wizardCapture as Mock;

interface ScreenEvent {
  event: string;
  from: unknown;
  program: unknown;
}

function screenEvents(): ScreenEvent[] {
  return wizardCapture.mock.calls
    .filter(([name]) => typeof name === 'string' && name.startsWith('screen '))
    .map(([name, props]) => ({
      event: name as string,
      from: (props as Record<string, unknown>)?.from_screen,
      program: (props as Record<string, unknown>)?.program_id,
    }));
}

const NODE = FRAMEWORK_REGISTRY[Integration.javascriptNode];

function createStore(program: ProgramId, integration: Integration | null) {
  const store = new FlowStore(flowFor(program).flow);
  setUI(new StoreUI(store));
  const session = buildSession({ installDir: '/app', ci: false });
  if (integration) {
    session.integration = integration;
    session.frameworkConfig = FRAMEWORK_REGISTRY[integration];
  }
  store.session = session;
  return store;
}

const approved = (ok: boolean) =>
  ({
    organization: { is_ai_data_processing_approved: ok },
  } as unknown as WizardSession['apiUser']);

/** Commit what a user, the runner, or the agent would commit on this screen. */
function advance(store: FlowStore, screen: string): boolean {
  const s = store.session;
  if (screen === 'intro' || screen.endsWith('-intro')) {
    store.completeSetup();
    return true;
  }
  switch (screen) {
    case 'health-check':
      store.setReadinessResult({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });
      return true;
    case 'setup': {
      const questions = s.frameworkConfig?.metadata.setup?.questions ?? [];
      for (const q of questions) {
        if (!(q.key in s.frameworkContext)) {
          store.setFrameworkContext(q.key, q.options[0].value);
        }
      }
      return true;
    }
    case 'auth':
      store.setCredentials({
        accessToken: 'phx_test',
        projectApiKey: 'phc_test',
        host: HostResolution.fromApiHost('https://us.posthog.com'),
        projectId: 1,
      });
      store.setApiUser(approved(false));
      return true;
    case 'ai-opt-in':
      store.setApiUser(approved(true));
      return true;
    case 'run':
    case 'audit-run': {
      const steps = getProgramConfig(store.activeProgram).steps;
      const runStep = steps.find(
        (st) =>
          st.screenId === screen &&
          (!st.show || st.show(s)) &&
          (!st.isComplete || !st.isComplete(s)),
      );
      if (runStep?.run) {
        store.completeRunStep(runStep.id);
      } else {
        store.setRunPhase(RunPhase.Running);
        store.setRunPhase(RunPhase.Completed);
      }
      return true;
    }
    case 'outro':
    case 'audit-outro':
    case 'source-maps-outro':
      store.setOutroDismissed();
      return true;
    case 'doctor-report':
      store.setOutroData({ kind: OutroKind.Success, message: 'done' });
      return true;
    case 'mcp':
    case 'mcp-add':
    case 'mcp-remove':
      store.setMcpComplete(McpOutcome.Skipped);
      return true;
    case 'mcp-suggested-prompts':
      store.setMcpSuggestedPromptsDismissed();
      return true;
    case 'slack-connect':
      store.setSlackStepDismissed();
      return true;
    case 'keep-skills':
      store.setSkillsComplete(true);
      return true;
    case 'self-driving-integration-check':
      store.setIntegrate(true);
      return true;
    case 'self-driving-integration-detect':
      store.setFrameworkContext(SELF_DRIVING_INTEGRATE_PATH_KEY, '.');
      store.setFrameworkConfig(Integration.javascriptNode, NODE);
      return true;
    case 'self-driving-handoff':
      store.confirmSelfDrivingHandoff();
      return true;
    case 'self-driving-github':
      store.setGithubConnected(true);
      return true;
    case 'error-tracking-detect':
      store.setFrameworkContext(ERROR_TRACKING_PROJECT_PATH_KEY, '.');
      store.setFrameworkConfig(Integration.javascriptNode, NODE);
      return true;
    case 'source-maps-detect':
      store.setFrameworkContext(
        SOURCE_MAPS_CONTEXT_KEYS.selectedVariant,
        'node',
      );
      store.setFrameworkContext(SOURCE_MAPS_CONTEXT_KEYS.selectedPath, '.');
      return true;
    default:
      return false;
  }
}

function trace(program: ProgramId, integration: Integration | null) {
  wizardCapture.mockClear();
  const store = createStore(program, integration);
  const screens: string[] = [];
  let stoppedOn: string | null = null;
  for (let guard = 0; guard < 40; guard++) {
    const screen = store.currentScreen;
    screens.push(screen);
    if (screen === 'exit') break;
    if (!advance(store, screen)) {
      stoppedOn = screen;
      break;
    }
    if (store.session.skillsComplete) break;
  }
  return { program, screens, stoppedOn, events: screenEvents() };
}

describe('flow traces per program', () => {
  for (const config of PROGRAM_REGISTRY) {
    it(`${config.id} (node)`, () => {
      expect(trace(config.id, Integration.javascriptNode)).toMatchSnapshot();
    });
  }

  it('posthog-integration (nextjs, with a setup question)', () => {
    expect(trace('posthog-integration', Integration.nextjs)).toMatchSnapshot();
  });

  it('posthog-integration (no framework detected)', () => {
    expect(trace('posthog-integration', null)).toMatchSnapshot();
  });
});

describe('headless walk analytics', () => {
  for (const program of ['posthog-integration', 'audit'] as ProgramId[]) {
    it(`${program}: run phases without a TUI`, () => {
      wizardCapture.mockClear();
      const store = new FlowStore(flowFor(program).flow);
      setUI(new StoreUI(store));
      store.session = buildSession({ installDir: '/app', ci: true });
      store.setRunPhase(RunPhase.Running);
      store.setOutroData({ kind: OutroKind.Success, message: 'done' });
      store.setRunPhase(RunPhase.Completed);
      expect({
        program,
        screen: store.currentScreen,
        events: screenEvents(),
      }).toMatchSnapshot();
    });
  }
});
