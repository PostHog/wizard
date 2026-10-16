import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Integration } from '@shared/constants';
import { ScanConsent } from '@shared/run-state';

vi.mock('@agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent')>()),
  redactSecretLines: vi.fn((text: string) =>
    Promise.resolve({ text, redactedLines: 0 }),
  ),
}));

import { redactSecretLines } from '@agent';
import {
  collectDecisionsScan,
  manifestDirs,
} from '@programs/detection/decisions/scan';
import {
  renderDecisionInput,
  renderFileTree,
} from '@programs/detection/decisions/input';
import {
  askDecisions,
  DECISIONS_MAX_QUESTIONS_PER_CALL,
} from '@programs/detection/decisions/ask';
import {
  actionableAnswer,
  questionFacts,
  DECISIONS_KEY,
  getDecisions,
  runDecisionSpecs,
  summarizeAnswers,
} from '@programs/detection/decisions/service';
import {
  DECISIONS_ACCEPT_PROBABILITY,
  DECISIONS_AGREE_PROBABILITY,
  routeIntegration,
} from '@programs/detection/decisions/framework';
import { QUESTIONS } from '@programs/detection/decisions/questions';
import {
  compareProjectReports,
  judgeProjects,
} from '@programs/detection/decisions/projects';
import type {
  DecisionAnswer,
  DecisionQuestionSpec,
} from '@programs/detection/decisions/types';
import type { ProgramSession } from '@programs/program-session';

const GATEWAY = { gateway: { token: 'phs_test', url: 'https://gateway.test' } };

const tmpDirs: string[] = [];
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-decisions-'));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

type GatewayBody = {
  state: string;
  questions: Record<
    string,
    { type: string; criteria?: Record<string, unknown> }
  >;
};

/** A gateway that answers each choice with `choices[name]` (or its first criterion) and each predicate with `p`. */
function fakeGateway(
  options: {
    choices?: Record<string, string>;
    p?: number;
    status?: (call: number) => number | undefined;
  } = {},
) {
  let call = 0;
  return vi.fn(
    (_url: string | URL | Request, init?: Parameters<typeof fetch>[1]) => {
      const index = call++;
      const status = options.status?.(index);
      if (status) {
        return Promise.resolve(new Response('nope', { status }));
      }
      const body = JSON.parse(String(init?.body)) as GatewayBody;
      const answers = Object.fromEntries(
        Object.entries(body.questions).map(([name, q]) => {
          if (q.type === 'noul')
            return [name, { type: 'noul', noul: options.p ?? 0.9 }];
          const choice =
            options.choices?.[name] ?? Object.keys(q.criteria ?? {})[0];
          return [
            name,
            {
              type: 'choice',
              choice,
              confidence: 0.9,
              probabilities: { [choice]: 0.9 },
            },
          ];
        }),
      );
      return Promise.resolve(
        Response.json({
          model: 'openai/gpt-6-luna',
          answers,
          usage: { input_tokens: 100 },
        }),
      );
    },
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const predicate = (name: string): DecisionQuestionSpec => ({
  name,
  kind: 'predicate',
  instructions: `${name}?`,
  purpose: `test ${name}`,
});

describe('collectDecisionsScan', () => {
  it('records the tree, each manifest, lockfiles and env key names, never values', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { next: '15' } }),
      'apps/api/requirements.txt': 'django==5.0\nposthog\n',
      'pnpm-lock.yaml': 'lockfileVersion: 9',
      'apps/api/.env.local': 'DATABASE_URL=postgres://secret\n',
      'app/page.tsx': 'export default function Page() {}',
    });
    const snapshot = collectDecisionsScan(dir);
    expect(snapshot.files).toEqual(
      expect.arrayContaining(['package.json', 'app/page.tsx']),
    );
    expect(snapshot.manifests).toEqual(
      expect.arrayContaining([
        { path: 'package.json', ecosystem: 'npm', packages: ['next'] },
        {
          path: 'apps/api/requirements.txt',
          ecosystem: 'pypi',
          packages: ['django', 'posthog'],
        },
      ]),
    );
    expect(snapshot.lockfiles).toEqual(['pnpm-lock.yaml']);
    expect(snapshot.envKeys).toEqual([
      { name: 'DATABASE_URL', files: ['apps/api/.env.local'] },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('postgres://secret');
    expect(manifestDirs(snapshot)).toEqual(['.', 'apps/api']);
  });
});

describe('renderDecisionInput', () => {
  it('renders each fact as a section without file contents', () => {
    const input = renderDecisionInput(
      collectDecisionsScan(
        project({
          'package.json': JSON.stringify({ dependencies: { next: '15' } }),
          '.env': 'STRIPE_SECRET_KEY=sk_live_nope\n',
          'README.md': 'Private product notes',
        }),
      ),
    );
    expect(input).toContain('## File tree');
    expect(input).toContain('package.json (npm): next');
    expect(input).toContain('.env: STRIPE_SECRET_KEY');
    expect(input).not.toContain('sk_live_nope');
    expect(input).not.toContain('Private product notes');
  });

  it('caps entries per directory and total lines', () => {
    const files = Array.from({ length: 8 }, (_, i) => `f${i}.ts`);
    expect(renderFileTree(files, { maxEntriesPerDir: 5 })).toContain(
      '… +3 more files',
    );
    const deep = Array.from({ length: 50 }, (_, i) => `d${i}/f.ts`);
    expect(
      renderFileTree(deep, { maxLines: 10, maxEntriesPerDir: 100 }),
    ).toContain('(tree truncated)');
  });
});

describe('askDecisions', () => {
  const specs = [
    predicate('uses_x'),
    {
      name: 'pick',
      kind: 'choice' as const,
      instructions: 'Which?',
      choices: { a: null, b: 'the b one' },
      purpose: 'test pick',
    },
  ];

  it('maps predicate and choice answers by name', async () => {
    const fetchImpl = fakeGateway({ choices: { pick: 'b' }, p: 0.3 });
    const result = await askDecisions('input', specs, {
      transport: GATEWAY,
      fetchImpl,
    });
    expect(result.answers).toEqual({
      uses_x: { kind: 'predicate', probability: 0.3 },
      pick: {
        kind: 'choice',
        choice: 'b',
        probability: 0.9,
        probabilities: { b: 0.9 },
      },
    });
    expect(result.unanswered).toEqual([]);
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      'https://gateway.test/v1/systemone',
    );
  });

  it('sends the redacted input, and nothing when the scanner cannot load', async () => {
    vi.mocked(redactSecretLines).mockResolvedValueOnce({
      text: '[redacted]',
      redactedLines: 1,
    });
    const fetchImpl = fakeGateway();
    const redacted = await askDecisions('KEY=sk_live', specs, {
      transport: GATEWAY,
      fetchImpl,
    });
    const body = JSON.parse(
      String((fetchImpl.mock.calls[0][1] as Parameters<typeof fetch>[1])?.body),
    ) as GatewayBody;
    expect(body.state).toBe('[redacted]');
    expect(redacted.redactedLines).toBe(1);

    vi.mocked(redactSecretLines).mockRejectedValueOnce(new Error('no wasm'));
    const blocked = fakeGateway();
    const failed = await askDecisions('input', specs, {
      transport: GATEWAY,
      fetchImpl: blocked,
    });
    expect(blocked).not.toHaveBeenCalled();
    expect(failed.error).toMatch(/secret scanner unavailable/);
  });

  it('splits past the gateway limit and keeps the batches that answered', async () => {
    const many = Array.from(
      { length: DECISIONS_MAX_QUESTIONS_PER_CALL + 3 },
      (_, i) => predicate(`q${i}`),
    );
    const fetchImpl = fakeGateway({
      status: (call) => (call === 1 ? 400 : undefined),
    });
    const result = await askDecisions('input', many, {
      transport: GATEWAY,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.answers)).toHaveLength(
      DECISIONS_MAX_QUESTIONS_PER_CALL,
    );
    expect(result.unanswered).toHaveLength(3);
    expect(result.error).toMatch(/HTTP 400/);
  });
});

describe('runProgramDecisions', () => {
  const envMode = process.env.WIZARD_DECISIONS_DETECTION;
  afterEach(() => {
    if (envMode === undefined) delete process.env.WIZARD_DECISIONS_DETECTION;
    else process.env.WIZARD_DECISIONS_DETECTION = envMode;
  });

  function session(overrides: Partial<ProgramSession> = {}): ProgramSession {
    return {
      installDir: project({
        'package.json': JSON.stringify({ dependencies: { next: '15' } }),
      }),
      frameworkContext: {},
      credentials: { gateway: GATEWAY.gateway },
      scanConsent: ScanConsent.Granted,
      noTelemetry: false,
      ...overrides,
    } as unknown as ProgramSession;
  }

  function ctx(sess: ProgramSession, fetchImpl: typeof fetch) {
    return {
      session: sess,
      setFrameworkContext: (key: string, value: unknown) => {
        sess.frameworkContext[key] = value;
      },
      flags: {},
      fetchImpl,
    };
  }

  const specs = [
    predicate('uses_x'),
    { ...predicate('market'), shared: true as const },
  ];

  it('makes no call when the mode is off', async () => {
    process.env.WIZARD_DECISIONS_DETECTION = 'off';
    const fetchImpl = fakeGateway();
    const sess = session();
    expect(await runDecisionSpecs(specs, ctx(sess, fetchImpl))).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getDecisions(sess)).toBeUndefined();
  });

  it('stores shadow answers that programs may not act on', async () => {
    process.env.WIZARD_DECISIONS_DETECTION = 'shadow';
    const sess = session();
    await runDecisionSpecs(specs, ctx(sess, fakeGateway()));
    expect(getDecisions(sess)?.answers.uses_x).toBeDefined();
    expect(actionableAnswer(sess, 'uses_x')).toBeUndefined();
  });

  it('runs in shadow for true, and treats primary as off', async () => {
    process.env.WIZARD_DECISIONS_DETECTION = 'true';
    const on = session();
    await runDecisionSpecs(specs, ctx(on, fakeGateway()));
    expect(getDecisions(on)?.mode).toBe('shadow');
    expect(actionableAnswer(on, 'uses_x')).toBeUndefined();

    process.env.WIZARD_DECISIONS_DETECTION = 'primary';
    const fetchImpl = fakeGateway();
    expect(await runDecisionSpecs(specs, ctx(session(), fetchImpl))).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('leaves out shared questions when the user declined sharing', async () => {
    process.env.WIZARD_DECISIONS_DETECTION = 'shadow';
    const fetchImpl = fakeGateway();
    const sess = session({ scanConsent: ScanConsent.Declined });
    await runDecisionSpecs(specs, ctx(sess, fetchImpl));
    const body = JSON.parse(
      String((fetchImpl.mock.calls[0][1] as Parameters<typeof fetch>[1])?.body),
    ) as GatewayBody;
    expect(Object.keys(body.questions)).toEqual(['uses_x']);
  });

  it('records why nothing was asked without a gateway key', async () => {
    process.env.WIZARD_DECISIONS_DETECTION = 'shadow';
    const fetchImpl = fakeGateway();
    const sess = session({ credentials: null } as Partial<ProgramSession>);
    await runDecisionSpecs(specs, ctx(sess, fetchImpl));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      (sess.frameworkContext[DECISIONS_KEY] as { error: string }).error,
    ).toMatch(/no gateway key/);
  });
});

describe('summarizeAnswers', () => {
  it('flattens each answer to one value', () => {
    const answers: Record<string, DecisionAnswer> = {
      a: { kind: 'predicate', probability: 0.123 },
      b: { kind: 'choice', choice: 'x', probability: 0.876, probabilities: {} },
    };
    expect(summarizeAnswers(answers)).toEqual({ a: 0.12, b: 'x@0.88' });
  });
});

describe('routeIntegration', () => {
  const answer = (choice: string, probability: number): DecisionAnswer => ({
    kind: 'choice',
    choice,
    probability,
    probabilities: {},
  });

  it('falls back to static without an answer or with none', () => {
    expect(routeIntegration(undefined, Integration.nextjs).source).toBe(
      'static',
    );
    expect(
      routeIntegration(answer('none', 0.99), Integration.nextjs).integration,
    ).toBe(Integration.nextjs);
  });

  it('decides at the accept gate, and in the middle band only with static agreement or a miss', () => {
    expect(
      routeIntegration(
        answer(Integration.astro, DECISIONS_ACCEPT_PROBABILITY),
        Integration.javascriptNode,
      ),
    ).toEqual({ integration: Integration.astro, source: 'decisions' });
    const mid = answer(Integration.astro, DECISIONS_AGREE_PROBABILITY);
    expect(routeIntegration(mid, undefined).source).toBe('decisions');
    expect(routeIntegration(mid, Integration.nextjs).source).toBe('static');
  });
});

describe('judgeProjects', () => {
  const targets = [
    { id: 'nextjs', name: 'Next.js' },
    { id: 'django', name: 'Django' },
  ];

  it('classifies candidate folders, recommends one and looks up PostHog', async () => {
    const snapshot = collectDecisionsScan(
      project({
        'package.json': JSON.stringify({ workspaces: ['apps/*'] }),
        'apps/web/package.json': JSON.stringify({
          dependencies: { next: '15', 'posthog-js': '1' },
        }),
        'apps/api/requirements.txt': 'django\n',
      }),
    );
    const judged = await judgeProjects(snapshot, GATEWAY, {
      targets,
      recommend: true,
      fetchImpl: fakeGateway({
        choices: {
          project_0_target: 'none',
          project_1_target: 'django',
          project_2_target: 'nextjs',
          primary_app: 'apps/web',
        },
      }),
    });
    expect(judged?.confident).toBe(true);
    expect(judged?.report).toEqual({
      repoType: 'monorepo',
      projects: [
        {
          path: 'apps/web',
          framework: 'Next.js',
          targetId: 'nextjs',
          hasPostHog: true,
          recommended: true,
        },
        {
          path: 'apps/api',
          framework: 'Django',
          targetId: 'django',
          hasPostHog: false,
          recommended: false,
        },
      ],
    });
  });

  it('returns null when the call fails, so the caller keeps its agent scan', async () => {
    const snapshot = collectDecisionsScan(project({ 'go.mod': 'module x' }));
    expect(
      await judgeProjects(snapshot, GATEWAY, {
        targets,
        fetchImpl: fakeGateway({ status: () => 401 }),
      }),
    ).toBeNull();
  });

  it('compares reports by path and target', () => {
    const agent = {
      repoType: 'single' as const,
      projects: [
        {
          path: '.',
          framework: 'Next.js',
          targetId: 'nextjs',
          hasPostHog: false,
        },
      ],
    };
    expect(compareProjectReports(agent, agent)).toMatchObject({
      projects_agree: true,
      repo_type_agree: true,
    });
  });
});

describe('judgeProjects with one folder', () => {
  it('recommends it without asking a one-value choice', async () => {
    const fetchImpl = fakeGateway({ choices: { project_0_target: 'nextjs' } });
    const judged = await judgeProjects(
      collectDecisionsScan(
        project({
          'package.json': JSON.stringify({ dependencies: { next: '15' } }),
        }),
      ),
      GATEWAY,
      {
        targets: [{ id: 'nextjs', name: 'Next.js' }],
        recommend: true,
        fetchImpl,
      },
    );
    const body = JSON.parse(
      String((fetchImpl.mock.calls[0][1] as Parameters<typeof fetch>[1])?.body),
    ) as GatewayBody;
    expect(Object.keys(body.questions)).not.toContain('primary_app');
    expect(judged?.report.projects[0]).toMatchObject({
      path: '.',
      recommended: true,
    });
    expect(judged?.confident).toBe(true);
  });
});

describe('questionFacts', () => {
  function answered(
    mode: 'shadow' | 'primary',
    answers: Record<string, DecisionAnswer>,
  ): ProgramSession {
    return {
      frameworkContext: { [DECISIONS_KEY]: { mode, answers } },
    } as unknown as ProgramSession;
  }
  const keys = [
    'product_category',
    'calls_llm_api',
    'structured_logging',
    'otel_exporter',
  ] as const;

  it('renders the declared facts for confident primary answers only', () => {
    const session = answered('primary', {
      product_category: {
        kind: 'choice',
        choice: 'ecommerce',
        probability: 0.9,
        probabilities: {},
      },
      calls_llm_api: { kind: 'predicate', probability: 0.95 },
      structured_logging: { kind: 'predicate', probability: 0.05 },
      otel_exporter: { kind: 'predicate', probability: 0.4 },
    });
    expect(questionFacts(session, keys)).toEqual([
      'Product category: ecommerce. Shape the event plan around it.',
      QUESTIONS.calls_llm_api.facts?.likely,
      QUESTIONS.structured_logging.facts?.unlikely,
    ]);
  });

  it('gives no facts in shadow mode or for an "other" choice', () => {
    const answers: Record<string, DecisionAnswer> = {
      product_category: {
        kind: 'choice',
        choice: 'other',
        probability: 0.99,
        probabilities: {},
      },
      calls_llm_api: { kind: 'predicate', probability: 0.95 },
    };
    expect(questionFacts(answered('shadow', answers), keys)).toEqual([]);
    expect(
      questionFacts(answered('primary', answers), ['product_category']),
    ).toEqual([]);
  });
});

describe('decisionsTransport', () => {
  afterEach(() => {
    delete process.env.WIZARD_CI_GATEWAY_TOKEN_FILE;
    vi.resetModules();
  });

  it('uses the dev key file when the run has no pre-issued key', async () => {
    const tokenFile = path.join(project({ token: 'phs_dev_key\n' }), 'token');
    process.env.WIZARD_CI_GATEWAY_TOKEN_FILE = tokenFile;
    vi.resetModules();
    const { decisionsTransport } = await import(
      '@programs/detection/decisions/service'
    );
    const session = {
      credentials: { accessToken: 'pha_oauth', host: { region: 'us' } },
    } as unknown as ProgramSession;
    expect(decisionsTransport(session)).toEqual({
      gateway: {
        token: 'phs_dev_key\n',
        url: 'https://ai-gateway.us.posthog.com',
      },
    });
  });

  it('has no transport without a pre-issued key or a dev key file', async () => {
    vi.resetModules();
    const { decisionsTransport } = await import(
      '@programs/detection/decisions/service'
    );
    const session = {
      credentials: { accessToken: 'pha_oauth', host: { region: 'us' } },
    } as unknown as ProgramSession;
    expect(decisionsTransport(session)).toBeNull();
  });
});
