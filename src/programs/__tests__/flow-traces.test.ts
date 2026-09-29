/**
 * Golden screen sequences and `screen <name>` analytics per program, produced
 * by walking each program's steps through the store with a generic advance per
 * screen. Baseline for the surface split: must stay byte identical.
 *
 * Known defect recorded as-is: gated programs show `screen run`,
 * `screen ai-opt-in`, `screen run`. authenticate.ts sets credentials before
 * apiUser and the AI opt-in gate hides itself while apiUser is null, so the
 * router visits `run` twice. Fixing the ordering is a production analytics
 * change and belongs in its own PR; when it lands, re-record and add an
 * assertion that no trace visits `run` twice.
 */
import { WizardStore, ScreenId, RunPhase, McpOutcome } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui/index';
import {
  buildSession,
  OutroKind,
  type WizardSession,
} from '@lib/wizard-session';
import { Integration } from '@shared/constants';
import { FRAMEWORK_REGISTRY } from '@programs/frameworks/registry';
import { HostResolution } from '@shared/host-resolution';
import { WizardReadiness } from '@shared/health-checks/readiness';
import { analytics } from '@utils/analytics';
import {
  PROGRAM_REGISTRY,
  getProgramConfig,
  type ProgramId,
} from '../program-registry';
import { SELF_DRIVING_INTEGRATE_PATH_KEY } from '../self-driving/detect';
import { ERROR_TRACKING_PROJECT_PATH_KEY } from '../error-tracking/detect-agentic';
import { SOURCE_MAPS_CONTEXT_KEYS } from '../error-tracking-upload-source-maps/detect';

vi.mock('@utils/analytics', () => ({
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
  const store = new WizardStore(program);
  setUI(new InkUI(store));
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
function advance(store: WizardStore, screen: string): boolean {
  const s = store.session;
  if (screen === ScreenId.Intro || screen.endsWith('-intro')) {
    store.completeSetup();
    return true;
  }
  switch (screen) {
    case ScreenId.HealthCheck:
      store.setReadinessResult({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      });
      return true;
    case ScreenId.Setup: {
      const questions = s.frameworkConfig?.metadata.setup?.questions ?? [];
      for (const q of questions) {
        if (!(q.key in s.frameworkContext)) {
          store.setFrameworkContext(q.key, q.options[0].value);
        }
      }
      return true;
    }
    case ScreenId.Auth:
      store.setCredentials({
        accessToken: 'phx_test',
        projectApiKey: 'phc_test',
        host: HostResolution.fromApiHost('https://us.posthog.com'),
        projectId: 1,
      });
      store.setApiUser(approved(false));
      return true;
    case ScreenId.AiOptIn:
      store.setApiUser(approved(true));
      return true;
    case ScreenId.Run:
    case ScreenId.AuditRun: {
      const steps = getProgramConfig(store.router.activeProgram).steps;
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
    case ScreenId.Outro:
    case ScreenId.AuditOutro:
    case ScreenId.SourceMapsOutro:
      store.setOutroDismissed();
      return true;
    case ScreenId.DoctorReport:
      store.setOutroData({ kind: OutroKind.Success, message: 'done' });
      return true;
    case ScreenId.Mcp:
    case ScreenId.McpAdd:
    case ScreenId.McpRemove:
      store.setMcpComplete(McpOutcome.Skipped);
      return true;
    case ScreenId.McpSuggestedPrompts:
      store.setMcpSuggestedPromptsDismissed();
      return true;
    case ScreenId.SlackConnect:
      store.setSlackStepDismissed();
      return true;
    case ScreenId.KeepSkills:
      store.setSkillsComplete(true);
      return true;
    case ScreenId.SelfDrivingIntegrationCheck:
      store.setIntegrate(true);
      return true;
    case ScreenId.SelfDrivingIntegrationDetect:
      store.setFrameworkContext(SELF_DRIVING_INTEGRATE_PATH_KEY, '.');
      store.setFrameworkConfig(Integration.javascriptNode, NODE);
      return true;
    case ScreenId.SelfDrivingHandoff:
      store.confirmSelfDrivingHandoff();
      return true;
    case ScreenId.SelfDrivingGithub:
      store.setGithubConnected(true);
      return true;
    case ScreenId.ErrorTrackingDetect:
      store.setFrameworkContext(ERROR_TRACKING_PROJECT_PATH_KEY, '.');
      store.setFrameworkConfig(Integration.javascriptNode, NODE);
      return true;
    case ScreenId.SourceMapsDetect:
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
    const screen = store.router.resolve(store.session);
    screens.push(screen);
    if (screen === ScreenId.Exit) break;
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
      const store = new WizardStore(program);
      setUI(new InkUI(store));
      store.session = buildSession({ installDir: '/app', ci: true });
      store.setRunPhase(RunPhase.Running);
      store.setOutroData({ kind: OutroKind.Success, message: 'done' });
      store.setRunPhase(RunPhase.Completed);
      expect({
        program,
        screen: store.router.resolve(store.session),
        events: screenEvents(),
      }).toMatchSnapshot();
    });
  }
});
