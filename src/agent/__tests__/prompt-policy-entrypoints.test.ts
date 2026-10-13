import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HostResolution } from '@shared/host-resolution';
import { Harness, HAIKU_MODEL, Sequence } from '@shared/constants';
import { initializeAgent } from '@agent/agent-interface';
import { prepareRun } from '@agent/runner/shared/bootstrap';
import { runAgent } from '@agent/runner';
import { resetGatewaySession } from '@agent/gateway-session';
import { RunOutcome } from '@agent/runner/shared/types';
import type { ResolvedRunConfig } from '@agent/runner/shared/types';
import type { AgentProgress, RunConfig, RunInput } from '@agent/types';

vi.mock('@utils/debug');
vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
    setTag: vi.fn(),
  },
}));
// The machine's credential store is outside the run under test.
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawnSync: vi.fn(() => ({ status: 1 })),
}));
const query = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>()),
  query,
  tool: (
    name: string,
    description: string,
    schema: unknown,
    handler: unknown,
  ) => ({ name, description, schema, handler }),
  createSdkMcpServer: (options: unknown) => options,
}));

const PINNED = '  Operator policy é 🦔\n';
let server: http.Server;
let origin: string;
let dir: string;
let bodies: Record<string, unknown>[];
let bearers: (string | undefined)[];
let pinned: string | undefined;
let mintRequests: Record<string, unknown>[];

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-policy-'));
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (req.url === '/agent-menu.json') {
        res.end(
          JSON.stringify({
            agents: ['seed', 'setup'].map((id) => ({
              id,
              flow: 'test-flow',
              downloadUrl: `${origin}/${id}.md`,
            })),
          }),
        );
        return;
      }
      if (req.url === '/skill-menu.json') {
        res.end('{"categories":{}}');
        return;
      }
      if (req.url === '/seed.md' || req.url === '/setup.md') {
        res.end(
          `---\nflow: test-flow\nseed: ${
            req.url === '/seed.md'
          }\nlabel: Setup task\n---\nSet up the project.`,
        );
        return;
      }
      if (req.url === '/readyz') {
        res.writeHead(200);
        res.end('ok');
        return;
      }
      if (req.url === '/api/wizard/gateway_token/') {
        mintRequests.push(JSON.parse(raw));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            token: 'phe_local_minted',
            gateway_url: origin,
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            ...(pinned === undefined
              ? {}
              : { system_prompt: pinned, system_prompt_version: 1 }),
          }),
        );
        return;
      }
      bodies.push(JSON.parse(raw));
      bearers.push(
        req.headers.authorization ??
          (req.headers['x-api-key'] as string | undefined),
      );
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end('{"error":{"message":"fixture has no model"}}');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  pinned = PINNED;
  bodies = [];
  bearers = [];
  mintRequests = [];
  resetGatewaySession();
  query.mockReset();
  vi.stubEnv('HOME', dir);
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir);
  for (const name of [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
  ]) {
    vi.stubEnv(name, process.env[name]);
  }
});
afterEach(() => {
  for (const [args] of query.mock.calls) {
    fs.rmSync(args.options.env.CLAUDE_CONFIG_DIR, {
      recursive: true,
      force: true,
    });
  }
  resetGatewaySession();
  vi.unstubAllEnvs();
});

function inputs(harness: Harness = Harness.anthropic) {
  const binding = { sequence: Sequence.linear, harness, model: HAIKU_MODEL };
  const config: RunConfig = {
    programId: 'posthog-integration',
    composed: true,
    routing: { binding, record: false },
    skillsBaseUrl: '',
    wizardFlags: {},
    wizardFlagPayloads: {},
    scanReport: 'defer',
    run: {
      integrationLabel: 'Test setup',
      readOnly: true,
      prompt: () => 'Set up the project',
      requestRemark: false,
      spinnerMessage: 'Setting up',
      successMessage: 'Setup complete',
      estimatedDurationMinutes: 1,
      reportFile: '',
      docsUrl: '',
    },
  };
  const input: RunInput = {
    installDir: dir,
    credentials: {
      accessToken: 'pha_local',
      projectApiKey: 'local-key',
      projectId: 1,
      host: HostResolution.fromApiHost(origin),
    },
    project: null,
    apiUser: null,
    host: {},
    flags: {
      ci: true,
      signup: false,
      debug: false,
      e2eAsk: false,
      localMcp: false,
      captureAio: false,
      benchmark: false,
      yaraReport: false,
    },
  };
  const resolved: ResolvedRunConfig = {
    ...config,
    binding,
    switchboard: { program: config.programId, binding, flags: {} },
    wizardMetadata: {},
  };
  return { config, resolved, input };
}

it.each([Harness.pi, Harness.anthropic])(
  'carries the minted policy from prepareRun into %s triage HTTP',
  async (harness) => {
    const { resolved, input } = inputs(harness);
    const boot = await prepareRun(resolved, input);
    if (!boot.triageProvider) throw new Error('Missing triage provider');
    await boot.triageProvider('Classify this match');
    const body = bodies[0];
    const systems =
      harness === Harness.pi
        ? (body.input as { role: string; content: string }[])
            .filter((m) => m.role === 'system')
            .map((m) => m.content)
        : (body.system as { text: string }[]).map((m) => m.text);
    expect(systems).toEqual([PINNED]);
    expect(bearers[0]).toContain('phe_local_minted');
    expect(mintRequests[0]).toEqual({
      program: expect.any(String),
      reads_refusal_reason: true,
    });
  },
);

it('carries the minted policy from initializeAgent into triage HTTP', async () => {
  const { input } = inputs();
  const agent = await initializeAgent(
    {
      workingDirectory: dir,
      programId: 'posthog-integration',
      posthogMcpUrl: origin,
      posthogApiKey: input.credentials.accessToken,
      host: input.credentials.host,
      skillsBaseUrl: '',
      detectPackageManager: () =>
        Promise.resolve({ detected: [], primary: null, recommendation: '' }),
      readOnly: true,
    },
    {
      installDir: dir,
      ci: true,
      debug: false,
      benchmark: false,
      yaraReport: false,
      signup: false,
    },
  );
  await agent.triageProvider('Classify this match');
  expect(
    ((bodies[0].system ?? []) as { text: string }[]).map((m) => m.text),
  ).toEqual([PINNED]);
  expect(bearers[0]).toContain('phe_local_minted');
});

it('returns failed through the real SDK linear sequence without postRun or completion', async () => {
  const { config, input } = inputs();
  const postRun = vi.fn();
  const progress: AgentProgress[] = [];
  query.mockImplementation(function* () {
    yield {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '[posthog:abort] Outside permitted setup.' },
        ],
      },
    };
    yield { type: 'result', subtype: 'success' };
  });
  const result = await runAgent({ ...config, hooks: { postRun } }, input, {
    onProgress: (e) => progress.push(e),
  });
  expect(result.outcome).toBe(RunOutcome.Failed);
  expect(result.failure?.outroData?.body).toBe('Outside permitted setup.');
  expect(postRun).not.toHaveBeenCalled();
  expect(
    progress.some(
      (e) =>
        e.kind === 'completion' ||
        (e.kind === 'lifecycle' && e.phase === 'completed'),
    ),
  ).toBe(false);
});

it('reports a refused orchestrator task as failed, never completed or still running', async () => {
  const { config, input } = inputs();
  const progress: AgentProgress[] = [];
  const outcomes = vi.fn();
  let calls = 0;
  query.mockImplementation(async function* ({ options }) {
    calls += 1;
    if (calls === 1) {
      const enqueue = options.mcpServers['wizard-tools'].tools.find(
        (tool: { name: string }) => tool.name === 'enqueue_task',
      );
      await enqueue.handler({ type: 'setup' });
    } else {
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '[posthog:abort] Outside permitted setup.' },
          ],
        },
      };
    }
    yield { type: 'result', subtype: 'success' };
  });
  const result = await runAgent(
    {
      ...config,
      composed: false,
      skillsBaseUrl: origin,
      agentFlow: 'test-flow',
      routing: {
        binding: {
          harness: Harness.anthropic,
          sequence: Sequence.orchestrator,
          model: HAIKU_MODEL,
        },
        record: false,
      },
      hooks: { recordTaskOutcomes: outcomes },
    },
    input,
    { onProgress: (e) => progress.push(e) },
  );
  expect(result.outcome).toBe(RunOutcome.Failed);
  expect(result.failure?.message).toBe('Outside permitted setup.');
  expect(calls).toBe(2);
  expect(outcomes).toHaveBeenCalledWith([
    { type: 'setup', status: 'failed', optional: false },
  ]);
  expect(result.snapshot.tasks).toEqual([
    expect.objectContaining({ content: 'Setup task', status: 'failed' }),
  ]);
  expect(
    progress.some(
      (e) =>
        e.kind === 'completion' ||
        (e.kind === 'lifecycle' && e.phase === 'completed'),
    ),
  ).toBe(false);
});
