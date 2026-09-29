import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildSession,
  RunOutcome,
  runProgram,
  SessionStore,
  sessionControlTarget,
} from '@programs';
import { ErrorCodes } from '@shared/errors';
import { LoggingUI } from '../../renderers/logging-ui';
import { attachControlServer, ControlClient } from '@host/control';
import { headlessControlHooks } from '../hooks';

vi.mock(import('@programs'), async (original) => ({
  ...(await original()),
  runProgram: vi.fn(),
}));
vi.mock(import('@utils/analytics'), () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
  } as never,
  sessionProperties: () => ({}),
}));

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

async function controlled() {
  const store = new SessionStore(
    buildSession({ installDir: '/tmp/controlled', ci: true, apiKey: 'phx_k' }),
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-hooks-'));
  dirs.push(dir);
  const socketPath = path.join(dir, 's.sock');
  const handle = await attachControlServer(sessionControlTarget(store), {
    socketPath,
    surface: 'headless',
    mode: 'partial',
    version: 't',
    program: 'metrics',
    programIds: ['metrics'],
    hooks: headlessControlHooks({
      store,
      programId: 'metrics',
      credentials: { resolve: vi.fn() },
      log: new LoggingUI(),
      onProgress: vi.fn(),
      shutdown: () => Promise.resolve(),
    }),
  });
  return { store, handle, client: new ControlClient(socketPath) };
}

it('lets the parent answer the agent mid-run and records the settled run', async () => {
  const { client, handle, store } = await controlled();
  let runDir: string | undefined;
  vi.mocked(runProgram).mockImplementation(async (_id, input, options) => {
    runDir = input.store.session.installDir;
    const answers = await options!.interaction!.ask!(
      {
        id: 'q1',
        source: 'test',
        questions: [{ id: 'db', prompt: 'Which database?', kind: 'text' }],
      },
      { signal: new AbortController().signal },
    );
    input.store.pushStatus(`answered ${String(answers.db)}`);
    return {
      programId: 'metrics',
      outcome: RunOutcome.Success,
      runResults: [],
      artifacts: {},
      diagnostics: [],
    };
  });
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
    // The run worked in the request's dir; later requests resolve against the launch dir.
    expect(runDir).toBe('/tmp/controlled/apps/api');
    expect(store.session.installDir).toBe('/tmp/controlled');
    expect(runProgram).toHaveBeenCalledWith(
      'metrics',
      expect.objectContaining({ store, composed: true }),
      expect.anything(),
    );
  } finally {
    await handle.close();
  }
});

it('fails the request, not the process, when a controlled run fails', async () => {
  const { client, handle } = await controlled();
  vi.mocked(runProgram).mockResolvedValue({
    programId: 'metrics',
    outcome: RunOutcome.Failed,
    runResults: [],
    artifacts: {},
    diagnostics: [],
    failure: { code: ErrorCodes.AgentAbort, message: 'mint refused' },
  });
  try {
    await client.startRun({ programId: 'metrics' });
    await vi.waitFor(async () => {
      const [record] = await client.runs();
      expect(record).toMatchObject({ status: 'failed', error: 'mint refused' });
    });
    expect(await client.health()).toMatchObject({ ok: true });
  } finally {
    await handle.close();
  }
});
