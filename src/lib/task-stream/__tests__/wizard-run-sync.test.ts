import {
  WizardRunSync,
  RunTaskNames,
  createWizardRunSync,
} from '../wizard-run-sync';
import { RunPhase, buildSession } from '@lib/wizard-session';
import { HostResolution } from '@shared/host-resolution';
import { TaskStatus } from '@ui/wizard-ui';
import type { TaskItem } from '@ui/tui/store';
import { VERSION } from '@shared/version';
import { currentCredentials } from '@shared/oauth-session';

vi.mock('@shared/oauth-session', async (original) => ({
  ...(await original<typeof import('@shared/oauth-session')>()),
  currentCredentials: vi.fn(),
}));

const ID = '019edb1a-cce4-4000-8f6d-682061862da9';
const task = (
  status = TaskStatus.Pending,
  id = 'one',
  label = 'Install SDK',
): TaskItem => ({ id, label, status, done: status === TaskStatus.Completed });
function setup(mode: 'local' | 'cloud' = 'local') {
  const session = buildSession({
    installDir: '/synthetic/target-project',
    ci: false,
  });
  session.runPhase = RunPhase.Running;
  session.credentials = {
    accessToken: 'pha_test',
    projectApiKey: 'phc_unused',
    projectId: 42,
    host: HostResolution.fromApiHost('https://eu.posthog.com'),
  };
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockImplementation((_url, init) =>
      Promise.resolve(
        init?.method === 'POST'
          ? Response.json({ id: ID }, { status: 201 })
          : new Response(null, { status: init?.method === 'PUT' ? 204 : 200 }),
      ),
    );
  const onError = vi.fn();
  const options = {
    mode,
    assignedId: mode === 'cloud' ? ID : undefined,
    programId: 'revenue-analytics-setup',
    getSession: () => session,
    fetchImpl,
    onError,
  };
  const sync = new WizardRunSync(options);
  const writes = () =>
    fetchImpl.mock.calls.map(([url, init]) => ({
      url,
      method: init!.method,
      body: JSON.parse(init!.body as string),
    }));
  return { sync, session, fetchImpl, writes, onError, options };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(currentCredentials).mockImplementation((fallback) =>
    Promise.resolve(fallback),
  );
});
afterEach(() => {
  vi.useRealTimers();
});

it('creates once at execution start, freezes target identity, and finalizes after immutable task snapshots', async () => {
  const { sync, session, writes, fetchImpl } = setup();
  session.runPhase = RunPhase.Idle;
  sync.capture([]);
  expect(fetchImpl).not.toHaveBeenCalled();
  session.runPhase = RunPhase.Running;
  const items = [task()];
  sync.capture(items);
  items[0].status = TaskStatus.InProgress;
  sync.capture(items);
  items[0].status = TaskStatus.Completed;
  sync.capture(items);
  await sync.shutdown('completed', 2000);
  const requests = writes();
  expect(requests.map((r) => r.method)).toEqual([
    'POST',
    'PUT',
    'PUT',
    'PUT',
    'PATCH',
  ]);
  expect(requests[0].body).toEqual({
    program_id: 'revenue-analytics-setup',
    environment: 'local',
    workspace: { type: 'local_folder', project_name: 'target-project' },
    wizard_version: VERSION,
    idempotency_key: expect.stringMatching(/^[a-f0-9-]{36}$/),
  });
  expect(
    requests
      .slice(1)
      .every((r) => String(r.url).includes(`/42/wizard/runs/${ID}/`)),
  ).toBe(true);
  expect(requests.slice(1, 4).map((r) => r.body)).toEqual(
    ['created', 'running', 'completed'].map((status) => ({
      tasks: [{ name: 'Install SDK', status }],
    })),
  );
  expect(requests[4].body).toEqual({ status: 'completed' });
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['completed', 'failed', 'cancelled'] as const)(
  'latches the local %s outcome across overlapping shutdown calls',
  async (outcome) => {
    const { sync, writes } = setup();
    sync.capture([task(TaskStatus.InProgress)]);
    const first = sync.shutdown(outcome, 2000);
    expect(sync.shutdown('failed', 2000)).toBe(first);
    sync.capture([task(TaskStatus.Completed)]);
    await first;
    expect(writes().at(-1)!.body).toEqual({ status: outcome });
    expect(writes().filter((r) => r.method === 'PATCH')).toHaveLength(1);
  },
);

it.each(['completed', 'failed', 'cancelled'] as const)(
  'cloud %s writes only to its assignment and never finalizes',
  async (outcome) => {
    const { sync, writes } = setup('cloud');
    sync.capture([task()]);
    sync.capture([]);
    sync.capture(undefined);
    await sync.shutdown(outcome, 2000);
    expect(writes().map((r) => r.method)).toEqual(['PUT', 'PUT']);
    expect(writes()[1].body).toEqual({ tasks: [] });
  },
);

it('preserves order with one PUT in flight, including retries and a brief running state', async () => {
  const { sync, fetchImpl, writes } = setup('cloud');
  let release!: (response: Response) => void;
  fetchImpl.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const items = [task()];
  sync.capture(items);
  await vi.advanceTimersByTimeAsync(0);
  items[0].status = TaskStatus.InProgress;
  sync.capture(items);
  items[0].status = TaskStatus.Completed;
  sync.capture(items);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  release(new Response(null, { status: 503 }));
  await vi.advanceTimersByTimeAsync(500);
  await sync.shutdown('completed', 2000);
  expect(writes().map((r) => r.body.tasks[0].status)).toEqual([
    'created',
    'created',
    'running',
    'completed',
  ]);
});

it('deduplicates snapshots, maps every state, and ignores active labels', async () => {
  const { sync, writes } = setup('cloud');
  const states = [
    TaskStatus.Pending,
    TaskStatus.InProgress,
    TaskStatus.Completed,
    TaskStatus.Failed,
    TaskStatus.Skipped,
  ];
  sync.capture(states.map((s, i) => task(s, String(i), `Task ${i}`)));
  sync.capture(
    states.map((s, i) => ({
      ...task(s, String(i), `Task ${i}`),
      activeForm: 'Changing label',
    })),
  );
  await sync.shutdown('completed', 2000);
  expect(writes()).toHaveLength(1);
  expect(
    writes()[0].body.tasks.map((t: { status: string }) => t.status),
  ).toEqual(['created', 'running', 'completed', 'failed', 'completed']);
});

it('freezes unique names across labels, reordering, duplicate subjects, long names and reused agent IDs', () => {
  const names = new RunTaskNames();
  const a = task(),
    b = task(TaskStatus.Pending, 'two');
  expect(names.snapshot([a, b]).map((t) => t.name)).toEqual([
    'Install SDK',
    'Install SDK (2)',
  ]);
  expect(
    names.snapshot([{ ...b, label: 'Renamed' }, a]).map((t) => t.name),
  ).toEqual(['Install SDK (2)', 'Install SDK']);
  const long = 'x'.repeat(300);
  const result = names.snapshot([
    { ...a, source: 'agent-a', label: long },
    { ...a, source: 'agent-b', label: long },
  ]);
  expect(result[0].name).not.toBe(result[1].name);
  expect(result.every((t) => t.name.length <= 255)).toBe(true);
});

it.each([
  [task(TaskStatus.Pending, 'one', ' ')],
  [Object.assign(task(), { sourceStatus: 'cancelled' })],
  [Object.assign(task(), { sourceStatus: 'toString' })],
  [task(), task()],
  Array.from({ length: 101 }, (_, i) => task(TaskStatus.Pending, String(i))),
])(
  'bounds invalid snapshot diagnostics and still finalizes local runs',
  async (...items) => {
    const { sync, writes, onError } = setup();
    sync.capture(items);
    sync.capture(items);
    await sync.shutdown('failed', 2000);
    expect(writes().filter((r) => r.method === 'PUT')).toHaveLength(0);
    expect(writes().at(-1)!.body).toEqual({ status: 'failed' });
    expect(onError).toHaveBeenCalledTimes(1);
  },
);

it.each([400, 401, 403, 404, 409])(
  'stops permanent PUT failure %s without fallback',
  async (status) => {
    const { sync, fetchImpl, onError } = setup('cloud');
    fetchImpl.mockResolvedValue(
      new Response('private server details', { status }),
    );
    sync.capture([task()]);
    sync.capture([task(TaskStatus.Completed)]);
    await sync.shutdown('failed', 2000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onError.mock.calls)).not.toContain(
      'private server details',
    );
  },
);

it('honors bounded Retry-After then sends newer snapshots', async () => {
  const { sync, fetchImpl, writes } = setup('cloud');
  fetchImpl.mockResolvedValueOnce(
    new Response(null, { status: 429, headers: { 'Retry-After': '1' } }),
  );
  sync.capture([task()]);
  sync.capture([task(TaskStatus.Completed)]);
  await vi.advanceTimersByTimeAsync(999);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await sync.shutdown('completed', 2000);
  expect(writes().map((r) => r.body.tasks[0].status)).toEqual([
    'created',
    'created',
    'completed',
  ]);
});

it('exhausts network retries before finalizing and never retries local creation automatically', async () => {
  const { sync, fetchImpl, writes } = setup();
  const normal = fetchImpl.getMockImplementation()!;
  fetchImpl.mockImplementation((url, init) =>
    init?.method === 'PUT'
      ? Promise.reject(new Error('private network detail'))
      : normal(url, init),
  );
  sync.capture([task()]);
  await vi.advanceTimersByTimeAsync(1500);
  await sync.shutdown('completed', 2000);
  expect(writes().map((r) => r.method)).toEqual([
    'POST',
    'PUT',
    'PUT',
    'PUT',
    'PATCH',
  ]);
  const other = setup();
  other.fetchImpl.mockRejectedValue(new Error('ambiguous create'));
  other.sync.capture([]);
  await other.sync.shutdown('completed', 2000);
  expect(other.fetchImpl).toHaveBeenCalledTimes(1);
});

it('aborts hung PUTs and retry timers within shutdown budget, with no late writes', async () => {
  const { sync, fetchImpl, writes } = setup();
  const normal = fetchImpl.getMockImplementation()!;
  let signal: AbortSignal | undefined;
  fetchImpl.mockImplementation((url, init) => {
    if (init?.method !== 'PUT') return normal(url, init);
    signal = init.signal as AbortSignal;
    return new Promise(() => undefined);
  });
  sync.capture([task()]);
  sync.capture([task(TaskStatus.Completed)]);
  await vi.advanceTimersByTimeAsync(0);
  const closing = sync.shutdown('cancelled', 2000);
  await vi.advanceTimersByTimeAsync(2000);
  await closing;
  expect(signal!.aborted).toBe(true);
  expect(writes().map((r) => r.method)).toEqual(['POST', 'PUT', 'PATCH']);
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetchImpl).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it('refreshes a 401 through OAuth but never assumes refresh widens the grant', async () => {
  const { sync, session, fetchImpl } = setup('cloud');
  session.credentials!.refreshToken = 'phr_test';
  fetchImpl.mockResolvedValueOnce(new Response(null, { status: 401 }));
  let held = session.credentials!;
  vi.mocked(currentCredentials).mockImplementation((_fallback, force) => {
    if (force) held = { ...held, accessToken: 'pha_refreshed' };
    return Promise.resolve(held);
  });
  sync.capture([task()]);
  await sync.shutdown('completed', 2000);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fetchImpl.mock.calls[1][1]!.headers).toMatchObject({
    Authorization: 'Bearer pha_refreshed',
  });
  const narrowed = setup();
  narrowed.session.credentials!.missingScopes = ['wizard_run:write'];
  narrowed.sync.capture([]);
  await narrowed.sync.shutdown('completed', 2000);
  expect(narrowed.fetchImpl).not.toHaveBeenCalled();
});

it('pins the authenticated host/project and rejects malformed assignments without local fallback', async () => {
  const { options, session, fetchImpl, onError } = setup('cloud');
  const invalid = new WizardRunSync({ ...options, assignedId: '' });
  invalid.capture([]);
  await invalid.shutdown('completed', 2000);
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledTimes(1);
  const sync = new WizardRunSync(options);
  sync.capture([task()]);
  await vi.advanceTimersByTimeAsync(0);
  session.credentials!.projectId = 43;
  sync.capture([]);
  await sync.shutdown('completed', 2000);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('disables CI, telemetry opt-out, and explicit legacy headless mode', () => {
  const { options } = setup();
  expect(
    createWizardRunSync({ ...options, mode: 'ci', noTelemetry: false }),
  ).toBeUndefined();
  expect(
    createWizardRunSync({ ...options, mode: 'local', noTelemetry: true }),
  ).toBeUndefined();
  process.env.POSTHOG_TASK_RUN_ID = ID;
  expect(
    createWizardRunSync({ ...options, mode: 'headless', noTelemetry: false }),
  ).toBeUndefined();
  delete process.env.POSTHOG_TASK_RUN_ID;
});

it.each(['https://eu.i.posthog.com', 'http://localhost:8010'])(
  'uses the resolved application API host for %s',
  async (host) => {
    const { sync, session, writes } = setup();
    session.credentials!.host = HostResolution.fromApiHost(host);
    sync.capture([]);
    await sync.shutdown('completed', 2000);
    expect(writes()[0].url).toBe(
      `${
        host.includes('eu.i.') ? 'https://eu.posthog.com' : host
      }/api/projects/42/wizard/runs/`,
    );
  },
);

it('does not interpret teardown as an intentional task clear', async () => {
  const { sync, session, writes } = setup('cloud');
  sync.capture([task(TaskStatus.Completed)]);
  session.runPhase = RunPhase.Idle;
  sync.capture([]);
  await sync.shutdown('completed', 2000);
  expect(writes()).toHaveLength(1);
  expect(writes()[0].body.tasks).toHaveLength(1);
});

it('uses a fresh creation key for each independent execution', async () => {
  const first = setup(),
    second = setup();
  first.sync.capture([]);
  second.sync.capture([]);
  await Promise.all([
    first.sync.shutdown('completed', 2000),
    second.sync.shutdown('completed', 2000),
  ]);
  expect(first.writes()[0].body.idempotency_key).not.toBe(
    second.writes()[0].body.idempotency_key,
  );
});

it.each(['local', 'cloud'] as const)(
  'selects exactly one remote transport for %s executions and keeps file output',
  async (mode) => {
    const { WizardStore } = await import('@ui/tui/store');
    const { TaskStreamPush } = await import('../task-stream-push');
    for (const variant of [
      'wizard-run',
      'wizard-session',
      'false',
      'unknown',
      undefined,
    ]) {
      const { session, fetchImpl, options, writes } = setup(mode);
      const store = new WizardStore();
      store.session = session;
      let flags: Record<string, string> = variant
        ? { 'wizard-run-sync': variant }
        : {};
      const legacy = {
        name: 'posthog',
        send: vi.fn().mockResolvedValue(undefined),
      };
      const file = { name: 'file', send: vi.fn().mockResolvedValue(undefined) };
      const stream = new TaskStreamPush({
        store,
        programId: options.programId,
        runSync: new WizardRunSync({
          ...options,
          getSession: () => store.session,
        }),
        getFlags: () => flags,
        destinations: [legacy, file],
      });
      stream.attach();
      store.syncTodos([
        { id: 'one', content: 'Inspect', status: 'in_progress' },
      ]);
      flags = {
        'wizard-run-sync':
          variant === 'wizard-run' ? 'wizard-session' : 'wizard-run',
      };
      store.syncTodos([{ id: 'one', content: 'Inspect', status: 'completed' }]);
      await stream.shutdown(2000, 'completed');
      expect(file.send).toHaveBeenCalled();
      if (variant === 'wizard-run') {
        expect(legacy.send).not.toHaveBeenCalled();
        expect(
          writes()
            .filter((r) => r.method === 'PUT')
            .map((r) => r.body.tasks),
        ).toContainEqual([{ name: 'Inspect', status: 'running' }]);
        expect(writes().at(-1)?.method).toBe(
          mode === 'local' ? 'PATCH' : 'PUT',
        );
      } else {
        expect(legacy.send).toHaveBeenCalled();
        expect(fetchImpl).not.toHaveBeenCalled();
      }
    }
  },
);

it('waits for authenticated flags, then keeps run failures on the selected transport', async () => {
  const { WizardStore } = await import('@ui/tui/store');
  const { TaskStreamPush } = await import('../task-stream-push');
  const { session, options, fetchImpl } = setup('cloud');
  const store = new WizardStore();
  store.session = session;
  let flags: Record<string, string> | null = null;
  const legacy = {
    name: 'posthog',
    send: vi.fn().mockResolvedValue(undefined),
  };
  const stream = new TaskStreamPush({
    store,
    programId: options.programId,
    runSync: new WizardRunSync({ ...options, getSession: () => store.session }),
    getFlags: () => flags,
    destinations: [legacy],
  });
  stream.attach();
  await vi.advanceTimersByTimeAsync(0);
  expect(legacy.send).not.toHaveBeenCalled();
  expect(fetchImpl).not.toHaveBeenCalled();
  flags = { 'wizard-run-sync': 'wizard-run' };
  fetchImpl.mockResolvedValue(new Response(null, { status: 403 }));
  store.syncTodos([{ id: 'one', content: 'Inspect', status: 'in_progress' }]);
  await vi.advanceTimersByTimeAsync(0);
  store.syncTodos([{ id: 'one', content: 'Inspect', status: 'completed' }]);
  await stream.shutdown(2000, 'completed');
  expect(fetchImpl).toHaveBeenCalledOnce();
  expect(legacy.send).not.toHaveBeenCalled();
});
