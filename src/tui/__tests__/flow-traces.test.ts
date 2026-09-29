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
import { WizardStore, ScreenId } from '@tui/store';
import { McpOutcome, RunPhase } from '@shared/run-state';
import { getFlow } from '@tui/programs/index';
import {
  buildSession,
  FRAMEWORK_REGISTRY,
  PROGRAM_REGISTRY,
  getProgramConfig,
} from '@programs';
import type { WizardSession } from '@programs/types';
import { OutroKind } from '@shared/outro';
import { Integration } from '@shared/constants';
import { HostResolution } from '@shared/host-resolution';
import { WizardReadiness } from '@shared/health-checks/readiness';
import { analytics } from '@utils/analytics';
import { TOOL_REGISTRY } from '@tools';
import type { ProgramId } from '@programs/types';
import { SELF_DRIVING_INTEGRATE_PATH_KEY } from '@programs/self-driving';
import { ERROR_TRACKING_PROJECT_PATH_KEY } from '@programs/error-tracking';
import { SOURCE_MAPS_CONTEXT_KEYS } from '@programs/error-tracking-upload-source-maps';
import { AuditScreenId } from '@tui/programs/audit';
import { ErrorTrackingScreenId } from '@tui/programs/error-tracking';
import { McpScreenId } from '@tui/tools/mcp';
import { PostHogIntegrationScreenId } from '@tui/programs/posthog-integration';
import { PosthogDoctorScreenId } from '@tui/tools/doctor';
import { SelfDrivingScreenId } from '@tui/programs/self-driving';
import { SourceMapsScreenId } from '@tui/programs/error-tracking-upload-source-maps';
import { applySetter } from '@tui/__tests__/helpers/apply-setter.no-jest';

vi.mock(import('@utils/analytics'), () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    captureException: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as never,
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
  if (
    screen === PostHogIntegrationScreenId.Intro ||
    screen.endsWith('-intro')
  ) {
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
    case AuditScreenId.Run: {
      const steps = getFlow(store.router.activeProgram);
      const runStep = steps.find(
        (st) =>
          st.screenId === screen &&
          (!st.show || st.show(store)) &&
          (!st.isComplete || !st.isComplete(store)),
      );
      if (
        runStep &&
        getProgramConfig(store.router.activeProgram).runSteps?.[runStep.id]
          ?.runProgramId
      ) {
        store.completeRunStep(runStep.id);
      } else {
        store.setRunPhase(RunPhase.Running);
        store.setRunPhase(RunPhase.Completed);
      }
      return true;
    }
    case ScreenId.Outro:
    case AuditScreenId.Outro:
    case SourceMapsScreenId.Outro:
      store.setOutroDismissed();
      return true;
    case PosthogDoctorScreenId.Report:
      store.setOutroData({ kind: OutroKind.Success, message: 'done' });
      return true;
    case ScreenId.Mcp:
    case McpScreenId.Add:
    case McpScreenId.Remove:
      store.setMcpComplete(McpOutcome.Skipped);
      return true;
    case McpScreenId.SuggestedPrompts:
      applySetter(store, 'setMcpSuggestedPromptsDismissed');
      return true;
    case ScreenId.SlackConnect:
      store.setSlackStepDismissed();
      return true;
    case ScreenId.KeepSkills:
      store.setSkillsComplete(true);
      return true;
    case SelfDrivingScreenId.IntegrationCheck:
      applySetter(store, 'setIntegrate', { integrate: true });
      return true;
    case SelfDrivingScreenId.IntegrationDetect:
      store.setFrameworkContext(SELF_DRIVING_INTEGRATE_PATH_KEY, '.');
      store.setFrameworkConfig(Integration.javascriptNode, NODE);
      return true;
    case SelfDrivingScreenId.Handoff:
      applySetter(store, 'confirmSelfDrivingHandoff');
      return true;
    case SelfDrivingScreenId.Github:
      applySetter(store, 'setGithubConnected', { connected: true });
      return true;
    case ErrorTrackingScreenId.Detect:
      store.setFrameworkContext(ERROR_TRACKING_PROJECT_PATH_KEY, '.');
      store.setFrameworkConfig(Integration.javascriptNode, NODE);
      return true;
    case SourceMapsScreenId.Detect:
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
    const screen = store.router.resolve(store);
    screens.push(screen);
    if (screen === ScreenId.Exit) break;
    if (!advance(store, screen)) {
      stoppedOn = screen;
      break;
    }
    if (store.skillsComplete) break;
  }
  return { program, screens, stoppedOn, events: screenEvents() };
}

describe('flow traces per program', () => {
  for (const { id } of [...PROGRAM_REGISTRY, ...TOOL_REGISTRY]) {
    it(`${id} (node)`, () => {
      expect(trace(id, Integration.javascriptNode)).toMatchSnapshot();
    });
  }

  it('posthog-integration (nextjs, with a setup question)', () => {
    expect(trace('posthog-integration', Integration.nextjs)).toMatchSnapshot();
  });

  it('posthog-integration (no framework detected)', () => {
    expect(trace('posthog-integration', null)).toMatchSnapshot();
  });
});
