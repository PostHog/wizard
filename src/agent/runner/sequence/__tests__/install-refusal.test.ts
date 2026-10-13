/**
 * A triage refusal during a sequence's skill install ends the run as a policy
 * refusal: the linear install, the orchestrator reference install, and a task's
 * install, which is never retried.
 */
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

const REASON = 'Outside permitted setup.';
const state = vi.hoisted(() => ({
  /** The skill whose scan refuses: it trips the latch, as the triage provider does. */
  refusedSkill: '',
  operatorAbort: undefined as
    | { trip(reason: string): void; reason?: string }
    | undefined,
  installs: [] as string[],
  harnessCalls: 0,
}));
vi.mock('@shared/skill-install', () => ({
  installSkillById: (skillId: string) => {
    state.installs.push(skillId);
    if (skillId !== state.refusedSkill)
      return Promise.resolve({ kind: 'ok', path: `skills/${skillId}` });
    state.operatorAbort?.trip(REASON);
    return Promise.resolve({ kind: 'download-failed', message: 'scan' });
  },
}));
vi.mock('@shared/skill-menu', () => ({
  fetchSkillMenu: () =>
    Promise.resolve({
      categories: {
        integration: [
          {
            id: 'integration-django',
            name: 'Django',
            downloadUrl: '',
            group: 'integration',
            framework: 'django',
          },
          { id: 'step-skill', name: 'Step', downloadUrl: '' },
        ],
      },
    }),
}));
vi.mock('../../switchboard', async () => {
  const { VALID_MODELS } = await import('../../switchboard/models');
  return {
    resolveHarness: () => ({ harness: 'pi', model: [...VALID_MODELS][0] }),
    resolveStageOverrides: () => ({}),
    areSeededTasksEnabled: () => false,
    getHarness: () => ({
      run: () => {
        state.harnessCalls += 1;
        return Promise.resolve({ kind: 'success' });
      },
      runTask: (raw: unknown) => {
        state.harnessCalls += 1;
        const { orchestrator, analyticsProperties } = raw as {
          orchestrator: { store: QueueStore };
          analyticsProperties: { task_type: string; task_id: string };
        };
        if (analyticsProperties.task_type === 'seed') {
          const install = orchestrator.store.enqueue({
            type: 'install',
            maxAttempts: 3,
          });
          orchestrator.store.enqueue({
            type: 'report',
            dependsOn: [install.id],
          });
        } else {
          orchestrator.store.complete(analyticsProperties.task_id);
        }
        return Promise.resolve({ kind: 'success' });
      },
    }),
  };
});
vi.mock('../../../agent-prompt-loader', async (importActual) => {
  const actual = await importActual<
    typeof import('../../../agent-prompt-loader')
  >();
  const prompt = (type: string, over: object = {}) => ({
    type,
    flow: 'test-flow',
    seed: false,
    sink: false,
    runnerSeeded: false,
    optional: false,
    skills: [],
    allowedTools: [],
    disallowedTools: [],
    dependsOn: [],
    body: type,
    ...over,
  });
  return {
    ...actual,
    loadAgentRegistry: () =>
      Promise.resolve(
        actual.buildRegistry(
          [
            prompt('plan', { seed: true }),
            prompt('install', { skills: ['step-skill'] }),
            prompt('report', { sink: true }),
          ],
          'test-flow',
        ),
      ),
  };
});

import { OperatorAbort } from '../../../output-signals';
import { RunOutcome } from '../../shared/types';
import type { SequenceContext } from '../../shared/types';
import type { QueueStore } from '../orchestrator/queue';
import { runOrchestrator } from '../orchestrator/orchestrator-runner';
import { runLinearProgram } from '../linear';

let dir: string;
let operatorAbort: OperatorAbort;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-refusal-'));
  operatorAbort = new OperatorAbort();
  state.operatorAbort = operatorAbort;
  state.installs = [];
  state.harnessCalls = 0;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const boot = () => ({
  skillsBaseUrl: 'https://skills.test',
  operatorAbort,
  credentials: {
    projectId: 1,
    projectApiKey: 'phc_test',
    host: {
      apiHost: 'https://us.posthog.test',
      appHost: 'https://us.posthog.test',
    },
  },
});

const runOrchestrated = () =>
  runOrchestrator({
    config: {
      programId: 'test-flow',
      wizardFlags: {},
      wizardFlagPayloads: {},
      switchboard: {},
    },
    input: { installDir: dir, integration: 'django', flags: { ci: true } },
    boot: boot(),
    emit: vi.fn(),
    interaction: undefined,
  } as unknown as SequenceContext);

it('fails the linear run on a refused skill install, without running the agent', async () => {
  state.refusedSkill = 'step-skill';
  const result = await runLinearProgram({
    config: {
      programId: 'test',
      composed: true,
      binding: { harness: 'pi', sequence: 'linear', model: 'test' },
      run: {
        skillId: 'step-skill',
        integrationLabel: 'Test setup',
        docsUrl: '',
        structured: true,
        prompt: () => 'go',
      },
    },
    input: { installDir: dir, flags: { ci: true } },
    boot: boot(),
    emit: vi.fn(),
    interaction: undefined,
  } as unknown as SequenceContext);

  expect(result.outcome).toBe(RunOutcome.Failed);
  expect(result.failure?.outroData?.body).toBe(REASON);
  expect(state.harnessCalls).toBe(0);
});

it('fails the orchestrated run on a refused reference install, before the seed runs', async () => {
  state.refusedSkill = 'integration-django';

  const result = await runOrchestrated();

  expect(result.outcome).toBe(RunOutcome.Failed);
  expect(result.failure?.message).toBe(REASON);
  expect(state.harnessCalls).toBe(0);
});

it('fails the orchestrated run on a refused task install, without retrying it', async () => {
  state.refusedSkill = 'step-skill';

  const result = await runOrchestrated();

  expect(result.outcome).toBe(RunOutcome.Failed);
  expect(result.failure?.message).toBe(REASON);
  expect(state.installs.filter((id) => id === 'step-skill')).toHaveLength(1);
});
