import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { attachControlServer, ControlClient } from '@headless/control';
import { wizardStoreControlTarget } from '@tui/control/index';
import { InkUI } from '@tui/ink-ui';
import { buildSession } from '@tui/session';
import { WizardStore } from '@tui/store';
import { ErrorCodes } from '@shared/errors';
import { RunPhase } from '@shared/run-state';
import { getUI, setUI } from '../ui';
import {
  ControlledAbortError,
  createControlHooks,
  type ControlHookDeps,
} from '../control-hooks';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), setTag: vi.fn(), capture: vi.fn() },
  sessionProperties: () => ({}),
}));
vi.mock('@cli/wizard-abort', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cli/wizard-abort')>()),
  wizardAbort: () => {
    throw new Error('a controlled run reached for wizardAbort');
  },
}));

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

async function controlled(
  runProgramAgent: NonNullable<ControlHookDeps['runs']>['runProgramAgent'],
) {
  const store = new WizardStore('metrics');
  store.session = buildSession({
    installDir: '/tmp/controlled',
    ci: true,
    apiKey: 'phx_k',
  });
  setUI(new InkUI(store));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-hooks-'));
  dirs.push(dir);
  const socketPath = path.join(dir, 's.sock');
  const handle = await attachControlServer(
    wizardStoreControlTarget(store, { screens: false }),
    {
      socketPath,
      surface: 'headless',
      mode: 'partial',
      version: 't',
      program: 'metrics',
      hooks: createControlHooks({
        store,
        programId: 'metrics',
        runs: { runProgramAgent },
        shutdown: () => Promise.resolve(),
      }),
    },
  );
  return { store, handle, client: new ControlClient(socketPath) };
}

it('lets the parent answer the agent mid-run and records the settled run', async () => {
  const runProgramAgent = vi.fn(async () => {
    const answers = await getUI().requestQuestion({
      id: 'q1',
      source: 'test',
      questions: [{ id: 'db', prompt: 'Which database?', kind: 'text' }],
    });
    getUI().pushStatus(`answered ${String(answers.db)}`);
  });
  const { client, handle, store } = await controlled(runProgramAgent);
  try {
    await client.startRun({ programId: 'metrics', installDir: 'apps/api' });
    await vi.waitFor(async () => {
      expect((await client.state()).actions.map((a) => a.id)).toContain(
        'answer_question',
      );
    });
    await client.performAction('answer_question', {
      answers: { db: 'postgres' },
    });
    await vi.waitFor(async () => {
      const [record] = await client.runs();
      expect(record.status).toBe('done');
    });
    expect(store.statusMessages).toContain('answered postgres');
    expect(store.session.runPhase).toBe(RunPhase.Completed);
    expect(runProgramAgent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'metrics' }),
      expect.objectContaining({
        installDir: '/tmp/controlled/apps/api',
        programLabel: 'metrics',
      }),
      expect.objectContaining({ composed: true }),
    );
  } finally {
    await handle.close();
  }
});

it('fails the request, not the process, when a controlled run aborts', async () => {
  const runProgramAgent = vi.fn(
    async (
      _config: unknown,
      _session: unknown,
      options: { abort: (f?: object) => Promise<never> },
    ) => {
      await options.abort({
        code: ErrorCodes.AgentAbort,
        message: 'mint refused',
      });
    },
  );
  const { client, handle, store } = await controlled(runProgramAgent as never);
  try {
    await client.startRun({ programId: 'metrics' });
    await vi.waitFor(async () => {
      const [record] = await client.runs();
      expect(record).toMatchObject({ status: 'failed', error: 'mint refused' });
    });
    expect(store.session.runPhase).toBe(RunPhase.Error);
    expect(await client.health()).toMatchObject({ ok: true });
  } finally {
    await handle.close();
  }
  expect(new ControlledAbortError(undefined).message).toMatch(
    /decided failure/,
  );
});
