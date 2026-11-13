/** What a run does when the menu cannot supply a skill: the reference skill, or one a task names. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
  },
}));
vi.mock('@shared/skill-menu', () => ({
  fetchSkillMenu: () => Promise.resolve(menu),
}));
vi.mock('@shared/skill-install', async (importActual) => ({
  ...(await importActual<typeof import('@shared/skill-install')>()),
  installSkillById: () => Promise.resolve(installResult),
}));
vi.mock('../../../switchboard', async () => {
  const { VALID_MODELS } = await import('../../../switchboard/models');
  return {
    resolveHarness: () => ({ harness: 'pi', model: [...VALID_MODELS][0] }),
    resolveStageOverrides: () => ({}),
    areSeededTasksEnabled: () => false,
    isAgentDagEnabled: () => agentDag,
    getHarness: () => ({ runTask: (inputs: unknown) => harnessRun(inputs) }),
  };
});
vi.mock('../../../../agent-prompt-loader', async (importActual) => {
  const actual = await importActual<
    typeof import('../../../../agent-prompt-loader')
  >();
  return {
    ...actual,
    // The fetched flow: the same prompts, with the planner a fetched flow needs.
    loadAgentRegistry: (_url: string, flow: string, opts?: object) =>
      Promise.resolve(
        actual.bundledRegistry({ ...prompts, plan: PLANNER }, flow, opts),
      ),
  };
});

import type { InstallSkillResult } from '@shared/skill-install';
import { analytics } from '@utils/analytics';
import { RunOutcome } from '../../../shared/types';
import { runOrchestrator } from '../orchestrator-runner';
import type { SequenceContext } from '../../../shared/types';
import type { QueueStore } from '../queue';

const PLANNER = '---\nseed: true\n---\nplan';
const REPORT = '---\nsink: true\ndependsOn: [install]\n---\nreport';
const flowNaming = (skill?: string): Record<string, string> => ({
  install: `---\n${
    skill ? `skills: [${skill}]\n` : ''
  }dependsOn: []\n---\ninstall`,
  report: REPORT,
});

const entry = (id: string, rest: object = {}) => ({
  id,
  name: id,
  group: id,
  downloadUrl: `https://skills.test/${id}.zip`,
  ...rest,
});
const MENU = {
  categories: {
    skills: [
      entry('kept-skill'),
      entry('integration-nextjs', {
        group: 'integration',
        framework: 'nextjs',
        default: true,
      }),
    ],
  },
};

type Inputs = {
  emit: (event: { kind: 'handoff'; text: string }) => void;
  analyticsProperties: { task_type: string; task_id?: string };
  orchestrator: { store: QueueStore };
};

let agentDag = true;
let menu: typeof MENU | null = MENU;
let installResult: InstallSkillResult = { kind: 'ok', path: 'skills/x' };
let prompts: Record<string, string> = flowNaming();

/** The fake harness: a planner queues install then report, and every task completes. */
function harnessRun(raw: unknown) {
  const inputs = raw as Inputs;
  const { store } = inputs.orchestrator;
  const type = inputs.analyticsProperties.task_type;
  if (type === 'seed') {
    const install = store.enqueue({ type: 'install' });
    store.enqueue({ type: 'report', dependsOn: [install.id] });
  } else {
    if (type === 'report') inputs.emit({ kind: 'handoff', text: '# Report' });
    store.complete(inputs.analyticsProperties.task_id as string);
  }
  return Promise.resolve({ kind: 'success' as const });
}

describe('a skill the menu cannot supply', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-skills-'));
    agentDag = true;
    menu = MENU;
    installResult = { kind: 'ok', path: 'skills/x' };
    prompts = flowNaming();
    vi.mocked(analytics.wizardCapture).mockClear();
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = (integration?: string) =>
    runOrchestrator({
      config: {
        programId: 'flow',
        wizardFlags: {},
        wizardFlagPayloads: {},
        switchboard: {},
        agentPrompts: () => Promise.resolve(prompts),
      },
      input: { installDir: dir, flags: { ci: true }, integration },
      boot: {
        skillsBaseUrl: 'https://skills.test',
        wizardFlags: {},
        credentials: {
          projectId: 1,
          projectApiKey: 'phc_test',
          host: {
            apiHost: 'https://us.posthog.test',
            appHost: 'https://us.posthog.test',
          },
        },
      },
      emit: vi.fn(),
      interaction: undefined,
    } as unknown as SequenceContext);

  it('goes on without the reference skill and sends an event', async () => {
    installResult = { kind: 'download-failed', message: 'boom' };
    const result = await run('nextjs');
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'orchestrator reference skill unavailable',
      {
        skill: 'integration-nextjs',
        reason: 'download-failed',
        framework: 'nextjs',
      },
    );
  });

  it('says to run the latest wizard when a bundled prompt names a skill the menu no longer has', async () => {
    prompts = flowNaming('gone-skill');
    const result = await run();
    expect(result.outcome).toBe(RunOutcome.Failed);
    expect(result.failure?.message).toContain('npx @posthog/wizard@latest');
    expect(result.failure?.message).not.toContain('failed to download');
  });

  it.each([
    [
      'the prompts are fetched',
      () => {
        agentDag = false;
        prompts = flowNaming('gone-skill');
      },
    ],
    [
      'the menu did not load',
      () => {
        menu = null;
        prompts = flowNaming('gone-skill');
      },
    ],
    [
      'the menu has the family and the run has no framework',
      () => {
        prompts = flowNaming('integration');
      },
    ],
  ])('keeps the message that asks to try again when %s', async (_, arrange) => {
    arrange();
    const result = await run();
    expect(result.outcome).toBe(RunOutcome.Failed);
    expect(result.failure?.message).toContain('failed to download');
    expect(result.failure?.message).not.toContain('@posthog/wizard@latest');
  });
});
