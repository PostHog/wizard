import { http, HttpResponse } from 'msw';
import { gunzipSync } from 'node:zlib';
import { setupServer } from 'msw/node';
import { Analytics, groupsFromUser } from '@utils/analytics';
import { WorkflowsDistributionGate } from '@shared/workflows-distribution';
import { HostResolution } from '@shared/host-resolution';
import { ANALYTICS_HOST_URL } from '@shared/constants';
import type { Credentials, ApiUser } from '@shared/api';
import type { PostHogOptions, EventMessage } from 'posthog-node';

const sdkMode = vi.hoisted(() => ({ disabled: false, captureFailure: false }));

vi.mock('posthog-node', async (original) => {
  const sdk = await original<typeof import('posthog-node')>();
  return {
    ...sdk,
    PostHog: class extends sdk.PostHog {
      constructor(key: string, options: PostHogOptions) {
        super(key, {
          ...options,
          disabled: sdkMode.disabled,
          enableExceptionAutocapture: false,
        });
      }
      capture(message: EventMessage): void {
        if (
          sdkMode.captureFailure &&
          message.event === 'workflow distribution eligible'
        )
          throw new Error('Synthetic capture failure');
        super.capture(message);
      }
    },
  };
});

const build = vi.hoisted(() => ({ production: true }));
vi.mock('@env', async (original) => ({
  ...(await original<typeof import('@env')>()),
  get IS_PRODUCTION_BUILD() {
    return build.production;
  },
}));

const selectedUuid = '1f0b32d4-637e-4c84-8b62-cce2710bb8d3';
const defaultUuid = '219dab32-204d-4d73-ab33-7ba281d3f58b';
const appHost = 'https://us.posthog.com';
const sharedFlag = 'workflows-distribution';
const placementFlag = 'workflows-distribution-instrumentation-skill';
const server = setupServer();
type CapturedEvent = { event: string; properties: Record<string, unknown> };
let captured: CapturedEvent[];
let requests: {
  url: string;
  authorization: string | null;
  body?: Record<string, unknown>;
}[];
let client: Analytics;
let gate: WorkflowsDistributionGate;
let credentials: Credentials;
let flags: Record<string, { key: string; enabled: boolean; variant?: string }>;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  sdkMode.disabled = false;
  sdkMode.captureFailure = false;
  build.production = true;
  captured = [];
  requests = [];
  flags = {
    [sharedFlag]: { key: sharedFlag, enabled: true, variant: 'offer' },
    [placementFlag]: { key: placementFlag, enabled: true },
  };
  server.use(
    http.get(`${appHost}/api/projects/42/`, ({ request }) => {
      requests.push({
        url: request.url,
        authorization: request.headers.get('authorization'),
      });
      return HttpResponse.json({
        id: 42,
        uuid: selectedUuid,
        organization: defaultUuid,
        api_token: 'synthetic-ingestion-token',
        name: 'Example project',
      });
    }),
    http.post(`${ANALYTICS_HOST_URL}/flags/`, async ({ request }) => {
      requests.push({
        url: request.url,
        authorization: request.headers.get('authorization'),
        body: (await request.json()) as Record<string, unknown>,
      });
      return HttpResponse.json({
        flags,
        requestId: 'synthetic-evaluation-01',
        evaluatedAt: Date.now(),
      });
    }),
    http.post(`${ANALYTICS_HOST_URL}/batch/`, async ({ request }) => {
      const bytes = Buffer.from(await request.arrayBuffer());
      const body = JSON.parse(
        (request.headers.get('content-encoding') === 'gzip'
          ? gunzipSync(bytes)
          : bytes
        ).toString(),
      ) as { batch: CapturedEvent[] };
      captured.push(...body.batch);
      return new HttpResponse(null, { status: 200 });
    }),
  );
  client = new Analytics();
  const user: ApiUser = {
    distinct_id: 'synthetic-user-01',
    organization: { id: defaultUuid },
    team: { id: 41, uuid: defaultUuid, organization: defaultUuid },
    organizations: [],
  };
  client.identifyUser(user);
  client.setGroups(groupsFromUser(user, appHost));
  gate = new WorkflowsDistributionGate(client);
  credentials = {
    accessToken: 'synthetic-access-token',
    projectApiKey: 'synthetic-ingestion-token',
    projectId: 42,
    host: HostResolution.fromApiHost('https://us.i.posthog.com'),
  };
});
afterEach(async () => {
  await client.flush();
  delete process.env.WIZARD_CI_FLAG_OVERRIDES;
  server.resetHandlers();
});

function completedSource(signal = new AbortController().signal) {
  return {
    credentials,
    placementId: 'instrumentation-skill' as const,
    waveId: 'workflows-distribution-v1' as const,
    sourceActionId: 'synthetic-completion-01',
    signal,
  };
}

it('binds an authorized completed source to its selected project and captures eligibility', async () => {
  const result = await gate.evaluate(completedSource());
  await client.flush();
  expect(result).toMatchObject({
    status: 'offer',
    projectId: 42,
    projectUuid: selectedUuid,
    appHost,
    contextKey: 'e3ddc3f4-8021-5729-b751-c5de76d505a4',
  });
  expect(requests[0]).toEqual({
    url: `${appHost}/api/projects/42/`,
    authorization: 'Bearer synthetic-access-token',
  });
  expect(requests[1].body).toMatchObject({
    groups: { project: selectedUuid },
    flag_keys_to_evaluate: [sharedFlag, placementFlag],
  });
  const eligible = captured.filter(
    (event) => event.event === 'workflow distribution eligible',
  );
  expect(eligible).toHaveLength(1);
  expect(eligible[0].properties).toMatchObject({
    project_id: 42,
    project_uuid: selectedUuid,
    wave_id: 'workflows-distribution-v1',
    placement_id: 'instrumentation-skill',
    context_key: 'e3ddc3f4-8021-5729-b751-c5de76d505a4',
    arm: 'offer',
    stage: 'eligible',
    $groups: { project: selectedUuid },
  });
  expect(JSON.stringify(eligible)).not.toContain('synthetic-access-token');
});

it('rejects a readable response for a different project', async () => {
  server.use(
    http.get(`${appHost}/api/projects/42/`, () =>
      HttpResponse.json({
        id: 41,
        uuid: selectedUuid,
        organization: defaultUuid,
        api_token: 'synthetic-ingestion-token',
        name: 'Another example',
      }),
    ),
  );
  expect(await gate.evaluate(completedSource())).toMatchObject({
    status: 'unenrolled',
    reason: 'project-mismatch',
  });
  await client.flush();
  expect(requests).toHaveLength(0);
  expect(
    captured.some((event) => event.event === 'workflow distribution eligible'),
  ).toBe(false);
});

it('captures zero-click control without a delivery or workflow request', async () => {
  flags[sharedFlag].variant = 'control';
  expect(await gate.evaluate(completedSource())).toMatchObject({
    status: 'control',
    projectUuid: selectedUuid,
  });
  await client.flush();
  expect(
    captured.filter(
      (event) => event.event === 'workflow distribution eligible',
    ),
  ).toHaveLength(1);
  expect(
    captured.find((event) => event.event === 'workflow distribution eligible')
      ?.properties.arm,
  ).toBe('control');
  expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
    '/api/projects/42/',
    '/flags/',
  ]);
});

it.each([
  ['missing assignment', undefined, true],
  ['disabled assignment', false, true],
  ['unsupported assignment', 'off', true],
  ['missing placement', 'control', undefined],
  ['disabled placement', 'control', false],
  ['unsupported placement', 'control', 'off'],
] as const)(
  'does not enroll %s as a control',
  async (_label, assignment, placement) => {
    flags = {};
    if (assignment !== undefined)
      flags[sharedFlag] = {
        key: sharedFlag,
        enabled: assignment !== false,
        ...(typeof assignment === 'string' ? { variant: assignment } : {}),
      };
    if (placement !== undefined)
      flags[placementFlag] = {
        key: placementFlag,
        enabled: placement !== false,
        ...(typeof placement === 'string' ? { variant: placement } : {}),
      };
    expect(await gate.evaluate(completedSource())).toMatchObject({
      status: 'unenrolled',
    });
    await client.flush();
    expect(
      captured.some(
        (event) => event.event === 'workflow distribution eligible',
      ),
    ).toBe(false);
  },
);

it.each([
  { [sharedFlag]: 'offer' },
  { [sharedFlag]: { cohort: 'example' } },
  { [placementFlag]: true },
  { [placementFlag]: ['example'] },
])(
  'keeps requested-key overrides out of eligibility even when values match',
  async (override) => {
    process.env.WIZARD_CI_FLAG_OVERRIDES = JSON.stringify(override);
    expect(await gate.evaluate(completedSource())).toMatchObject({
      status: 'unenrolled',
      reason: 'overridden',
    });
    await client.flush();
    expect(
      captured.some(
        (event) => event.event === 'workflow distribution eligible',
      ),
    ).toBe(false);
  },
);

it('preserves unrelated person flag overrides and payloads while evaluating the selected project', async () => {
  process.env.WIZARD_CI_FLAG_OVERRIDES = JSON.stringify({
    'wizard-tools-menu': 'example-person-arm',
    'wizard-orchestrator': { sequence: 'linear' },
  });
  const personFlags = await client.getAllFlagsForWizard();
  const personPayloads = client.getWizardFlagPayloads();
  expect(await gate.evaluate(completedSource())).toMatchObject({
    status: 'offer',
  });
  expect(client.getCachedWizardFlags()).toEqual(personFlags);
  expect(client.getWizardFlagPayloads()).toEqual(personPayloads);
  expect(personFlags['wizard-tools-menu']).toBe('example-person-arm');
  expect(personPayloads['wizard-orchestrator']).toEqual({ sequence: 'linear' });
});

it('preserves malformed override configuration errors', async () => {
  process.env.WIZARD_CI_FLAG_OVERRIDES = 'invalid example';
  await expect(gate.evaluate(completedSource())).rejects.toThrow(
    /not valid JSON/,
  );
});

it('keeps non-production proof runs diagnostic and unenrolled', async () => {
  build.production = false;
  client.setTag('build', 'dev');
  expect(await gate.evaluate(completedSource())).toMatchObject({
    status: 'unenrolled',
    reason: 'diagnostic',
  });
  await client.flush();
  expect(
    captured.some((event) => event.event === 'workflow distribution eligible'),
  ).toBe(false);
});

it('coalesces completion replay without a second authorization, assignment or eligibility', async () => {
  const source = completedSource();
  const [first, concurrent] = await Promise.all([
    gate.evaluate(source),
    gate.evaluate(source),
  ]);
  const replay = await gate.evaluate(source);
  await client.flush();
  expect(concurrent).toEqual(first);
  expect(replay).toEqual(first);
  expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
    '/api/projects/42/',
    '/flags/',
  ]);
  expect(
    captured.filter(
      (event) => event.event === 'workflow distribution eligible',
    ),
  ).toHaveLength(1);
});

it.each(['cancelled', 'context-changed'] as const)(
  'honors %s before returning a settled completion replay',
  async (reason) => {
    const source = completedSource();
    expect(await gate.evaluate(source)).toMatchObject({ status: 'offer' });
    const cancellation = new AbortController();
    const replay = gate.evaluate({ ...source, signal: cancellation.signal });
    if (reason === 'cancelled') cancellation.abort();
    else gate.invalidate();
    expect(await replay).toMatchObject({
      status: 'unenrolled',
      reason,
    });
    await client.flush();
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/api/projects/42/',
      '/flags/',
    ]);
    expect(
      captured.filter(
        (event) => event.event === 'workflow distribution eligible',
      ),
    ).toHaveLength(1);
  },
);

it('cancels a delayed SDK result before eligibility and never returns a late offer', async () => {
  let release!: () => void;
  let started!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const evaluationStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  server.use(
    http.post(`${ANALYTICS_HOST_URL}/flags/`, async () => {
      started();
      await delayed;
      return HttpResponse.json({ flags });
    }),
  );
  const cancellation = new AbortController();
  const pending = gate.evaluate(completedSource(cancellation.signal));
  await evaluationStarted;
  cancellation.abort();
  expect(await pending).toMatchObject({
    status: 'unenrolled',
    reason: 'cancelled',
  });
  release();
  await client.flush();
  expect(
    captured.some((event) => event.event === 'workflow distribution eligible'),
  ).toBe(false);
});

it.each([401, 403])(
  'leaves a completed source unenrolled when the current project read returns %s',
  async (status) => {
    server.use(
      http.get(
        `${appHost}/api/projects/42/`,
        () => new HttpResponse(null, { status }),
      ),
    );
    expect(await gate.evaluate(completedSource())).toMatchObject({
      status: 'unenrolled',
    });
    await client.flush();
    expect(requests).toHaveLength(0);
    expect(
      captured.some(
        (event) => event.event === 'workflow distribution eligible',
      ),
    ).toBe(false);
  },
);

it('rejects an invalid project UUID before SDK evaluation', async () => {
  server.use(
    http.get(`${appHost}/api/projects/42/`, () =>
      HttpResponse.json({
        id: 42,
        uuid: 'invalid-example',
        organization: defaultUuid,
        api_token: 'synthetic-ingestion-token',
        name: 'Example project',
      }),
    ),
  );
  expect(await gate.evaluate(completedSource())).toMatchObject({
    status: 'unenrolled',
  });
  expect(requests).toHaveLength(0);
});

it.each([0, -1, Number.MAX_SAFE_INTEGER + 1, NaN])(
  'rejects an invalid selected project ID %s without a request',
  async (projectId) => {
    credentials.projectId = projectId;
    expect(await gate.evaluate(completedSource())).toMatchObject({
      status: 'unenrolled',
      reason: 'invalid-context',
    });
    expect(requests).toHaveLength(0);
  },
);

it('does not read a project when existing credentials lack project read scope', async () => {
  credentials.missingScopes = ['project:read'];
  expect(await gate.evaluate(completedSource())).toMatchObject({
    status: 'unenrolled',
    reason: 'unauthorized',
  });
  expect(requests).toHaveLength(0);
});

it('rejects an unsupported wave, placement or unbounded source action without a request', async () => {
  for (const input of [
    { waveId: 'unsupported-example' },
    { placementId: 'another-example' },
    { sourceActionId: '' },
    { sourceActionId: 'x'.repeat(129) },
  ]) {
    expect(
      await gate.evaluate({ ...completedSource(), ...input } as Parameters<
        typeof gate.evaluate
      >[0]),
    ).toMatchObject({ status: 'unenrolled', reason: 'invalid-context' });
  }
  expect(requests).toHaveLength(0);
});

it('invalidates an old project result when a new authorized project completes', async () => {
  let release!: () => void;
  let started!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const readStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const anotherUuid = 'dd776d9d-3ca3-43b7-8fd9-2b95b108a617';
  server.use(
    http.get(`${appHost}/api/projects/42/`, async () => {
      started();
      await delayed;
      return HttpResponse.json({
        id: 42,
        uuid: selectedUuid,
        organization: defaultUuid,
        api_token: 'synthetic-ingestion-token',
        name: 'First example',
      });
    }),
    http.get(`${appHost}/api/projects/43/`, () =>
      HttpResponse.json({
        id: 43,
        uuid: anotherUuid,
        organization: defaultUuid,
        api_token: 'synthetic-ingestion-token',
        name: 'Second example',
      }),
    ),
  );
  const old = gate.evaluate(completedSource());
  await readStarted;
  const next = await gate.evaluate({
    ...completedSource(),
    credentials: { ...credentials, projectId: 43 },
  });
  expect(await old).toMatchObject({
    status: 'unenrolled',
    reason: 'context-changed',
  });
  release();
  await client.flush();
  expect(next).toMatchObject({
    status: 'offer',
    projectId: 43,
    projectUuid: anotherUuid,
  });
  expect(
    captured
      .filter((event) => event.event === 'workflow distribution eligible')
      .map((event) => event.properties.project_uuid),
  ).toEqual([anotherUuid]);
});

it('does not reuse earlier authorization after an auth change and failed current read', async () => {
  expect(await gate.evaluate(completedSource())).toMatchObject({
    status: 'offer',
  });
  server.use(
    http.get(
      `${appHost}/api/projects/42/`,
      () => new HttpResponse(null, { status: 403 }),
    ),
  );
  credentials = { ...credentials, accessToken: 'synthetic-replaced-token' };
  expect(await gate.evaluate(completedSource())).toMatchObject({
    status: 'unenrolled',
  });
  await client.flush();
  expect(
    captured.filter(
      (event) => event.event === 'workflow distribution eligible',
    ),
  ).toHaveLength(1);
});

it('invalidates delayed eligibility when the new auth context has a missing grant', async () => {
  let release!: () => void;
  let started!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const evaluationStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  server.use(
    http.post(`${ANALYTICS_HOST_URL}/flags/`, async () => {
      started();
      await delayed;
      return HttpResponse.json({ flags });
    }),
  );
  const old = gate.evaluate(completedSource());
  await evaluationStarted;
  expect(
    await gate.evaluate({
      ...completedSource(),
      credentials: { ...credentials, missingScopes: ['project:read'] },
    }),
  ).toMatchObject({ status: 'unenrolled', reason: 'unauthorized' });
  release();
  expect(await old).toMatchObject({
    status: 'unenrolled',
    reason: 'context-changed',
  });
  await client.flush();
  expect(
    captured.some((event) => event.event === 'workflow distribution eligible'),
  ).toBe(false);
});

it('honors the completion deadline before a delayed SDK result can capture', async () => {
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.post(`${ANALYTICS_HOST_URL}/flags/`, async () => {
      await delayed;
      return HttpResponse.json({ flags });
    }),
  );
  const result = await gate.evaluate(completedSource(AbortSignal.timeout(50)));
  release();
  await client.flush();
  expect(result).toMatchObject({ status: 'unenrolled', reason: 'timeout' });
  expect(
    captured.some((event) => event.event === 'workflow distribution eligible'),
  ).toBe(false);
});

it('uses the existing credential refresh before the authorized project read', async () => {
  const { configureOAuthSession, resetOAuthSession } = await import(
    '@shared/oauth-session'
  );
  credentials = {
    ...credentials,
    refreshToken: 'synthetic-refresh-token',
    expiresAt: Date.now() + 1000,
  };
  configureOAuthSession(credentials, {
    rotate: (current) =>
      Promise.resolve({
        ...current,
        accessToken: 'synthetic-rotated-token',
        expiresAt: Date.now() + 7200000,
      }),
  });
  try {
    expect(await gate.evaluate(completedSource())).toMatchObject({
      status: 'offer',
    });
    expect(requests[0].authorization).toBe('Bearer synthetic-rotated-token');
  } finally {
    resetOAuthSession();
  }
});

it('never captures a delayed result after the grant is known to be revoked', async () => {
  const { markGrantRevoked, resetAuthSessionState } = await import(
    '@shared/auth-session-state'
  );
  let release!: () => void;
  let started!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const evaluationStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  server.use(
    http.post(`${ANALYTICS_HOST_URL}/flags/`, async () => {
      started();
      await delayed;
      return HttpResponse.json({ flags });
    }),
  );
  const pending = gate.evaluate(completedSource());
  await evaluationStarted;
  markGrantRevoked();
  release();
  try {
    expect(await pending).toMatchObject({
      status: 'unenrolled',
      reason: 'unauthorized',
    });
    await client.flush();
    expect(
      captured.some(
        (event) => event.event === 'workflow distribution eligible',
      ),
    ).toBe(false);
    expect(await gate.evaluate(completedSource())).toMatchObject({
      status: 'unenrolled',
      reason: 'unauthorized',
    });
  } finally {
    resetAuthSessionState();
  }
});

it('drops an assignment if its requested-key override appears during evaluation', async () => {
  let release!: () => void;
  let started!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const evaluationStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  server.use(
    http.post(`${ANALYTICS_HOST_URL}/flags/`, async () => {
      started();
      await delayed;
      return HttpResponse.json({ flags });
    }),
  );
  const pending = gate.evaluate(completedSource());
  await evaluationStarted;
  process.env.WIZARD_CI_FLAG_OVERRIDES = JSON.stringify({
    [sharedFlag]: 'offer',
  });
  release();
  expect(await pending).toMatchObject({
    status: 'unenrolled',
    reason: 'overridden',
  });
  await client.flush();
  expect(
    captured.some((event) => event.event === 'workflow distribution eligible'),
  ).toBe(false);
});

it('evaluates only the SDK placement chosen by its caller', async () => {
  const sdkFlag = 'workflows-distribution-sdk-wizard';
  flags = {
    [sharedFlag]: flags[sharedFlag],
    [sdkFlag]: { key: sdkFlag, enabled: true },
  };
  const result = await gate.evaluate({
    ...completedSource(),
    placementId: 'sdk-wizard',
  });
  await client.flush();
  expect(result).toMatchObject({ status: 'offer', placementId: 'sdk-wizard' });
  expect(requests[1].body).toMatchObject({
    flag_keys_to_evaluate: [sharedFlag, sdkFlag],
  });
  expect(
    captured
      .filter((event) => event.event === 'workflow distribution eligible')
      .map((event) => event.properties.placement_id),
  ).toEqual(['sdk-wizard']);
});

it('keeps a disabled installed SDK unenrolled', async () => {
  sdkMode.disabled = true;
  client = new Analytics();
  gate = new WorkflowsDistributionGate(client);
  expect(await gate.evaluate(completedSource())).toMatchObject({
    status: 'unenrolled',
  });
  expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
    '/api/projects/42/',
  ]);
});

it('keeps unavailable SDK transport unenrolled and preserves SDK diagnostics', async () => {
  server.use(
    http.post(
      `${ANALYTICS_HOST_URL}/flags/`,
      () => new HttpResponse(null, { status: 503 }),
    ),
  );
  expect(await gate.evaluate(completedSource())).toMatchObject({
    status: 'unenrolled',
  });
  await client.flush();
  expect(
    captured.some((event) => event.event === 'workflow distribution eligible'),
  ).toBe(false);
  expect(
    captured
      .filter((event) => event.event === '$feature_flag_called')
      .some((event) =>
        String(event.properties.$feature_flag_error).includes('flag_missing'),
      ),
  ).toBe(true);
});

it('retains the resolved arm when best-effort eligibility capture fails', async () => {
  sdkMode.captureFailure = true;
  expect(await gate.evaluate(completedSource())).toMatchObject({
    status: 'offer',
    eligibilityCapture: 'failed',
  });
  await client.flush();
  expect(
    captured.some((event) => event.event === 'workflow distribution eligible'),
  ).toBe(false);
});

it('keeps local PostHog projects diagnostic even in a production-mode proof', async () => {
  credentials = {
    ...credentials,
    host: HostResolution.fromApiHost('http://localhost:8010'),
  };
  expect(await gate.evaluate(completedSource())).toMatchObject({
    status: 'unenrolled',
    reason: 'diagnostic',
  });
  expect(requests).toHaveLength(0);
});

it('honors cancellation from a coalesced completion caller', async () => {
  let release!: () => void;
  let started!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const evaluationStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  server.use(
    http.post(`${ANALYTICS_HOST_URL}/flags/`, async () => {
      started();
      await delayed;
      return HttpResponse.json({ flags });
    }),
  );
  const first = gate.evaluate(completedSource());
  await evaluationStarted;
  const cancellation = new AbortController();
  const second = gate.evaluate(completedSource(cancellation.signal));
  cancellation.abort();
  try {
    expect(
      await Promise.race([
        second,
        new Promise((resolve) =>
          setTimeout(() => resolve({ status: 'still-pending' }), 100),
        ),
      ]),
    ).toMatchObject({ status: 'unenrolled', reason: 'cancelled' });
  } finally {
    release();
  }
  expect(await first).toMatchObject({ status: 'unenrolled' });
  await client.flush();
  expect(
    captured.some((event) => event.event === 'workflow distribution eligible'),
  ).toBe(false);
});

it('treats a null override object as a configuration error', async () => {
  process.env.WIZARD_CI_FLAG_OVERRIDES = 'null';
  await expect(gate.evaluate(completedSource())).rejects.toThrow();
});

it('binds provisioning credentials without a stored project UUID through the same current read', async () => {
  expect(credentials).not.toHaveProperty('project');
  expect(credentials).not.toHaveProperty('projectUuid');
  expect(
    await gate.evaluate({
      ...completedSource(),
      sourceActionId: 'synthetic-provisioned-completion',
    }),
  ).toMatchObject({
    status: 'offer',
    projectId: 42,
    projectUuid: selectedUuid,
  });
  expect(requests[0].url).toBe(`${appHost}/api/projects/42/`);
});

it('invalidates a prior host binding before evaluating the new host', async () => {
  expect(await gate.evaluate(completedSource())).toMatchObject({
    status: 'offer',
    appHost,
  });
  const europeanUuid = 'a24fb76e-b210-44f0-9a44-a8f14055e6cb';
  server.use(
    http.get('https://eu.posthog.com/api/projects/42/', ({ request }) => {
      requests.push({
        url: request.url,
        authorization: request.headers.get('authorization'),
      });
      return HttpResponse.json({
        id: 42,
        uuid: europeanUuid,
        organization: defaultUuid,
        api_token: 'synthetic-ingestion-token',
        name: 'Regional example',
      });
    }),
  );
  credentials = {
    ...credentials,
    host: HostResolution.fromApiHost('https://eu.i.posthog.com'),
  };
  expect(await gate.evaluate(completedSource())).toMatchObject({
    status: 'offer',
    appHost: 'https://eu.posthog.com',
    projectUuid: europeanUuid,
  });
  await client.flush();
  expect(
    captured
      .filter((event) => event.event === 'workflow distribution eligible')
      .map((event) => event.properties.$groups),
  ).toEqual([
    { project: selectedUuid, instance: appHost, organization: defaultUuid },
    {
      project: europeanUuid,
      instance: 'https://eu.posthog.com',
      organization: defaultUuid,
    },
  ]);
});

it('does not classify local MCP tooling alone as a forced project assignment', async () => {
  credentials = {
    ...credentials,
    host: HostResolution.fromApiHost('https://us.i.posthog.com', {
      localMcp: true,
    }),
  };
  expect(await gate.evaluate(completedSource())).toMatchObject({
    status: 'offer',
  });
});
