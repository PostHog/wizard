import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Integration } from '@shared/constants';
import { DiscoveryConsent } from '@shared/run-state';

vi.mock('@agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent')>()),
  redactSecretLines: vi.fn((text: string) =>
    Promise.resolve({ text, redactedLines: 0 }),
  ),
  gatewayAuth: vi.fn(),
}));

import { gatewayAuth, redactSecretLines } from '@agent';
import { walkRepo, manifestDirs } from '@services/project-discovery/walk';
import {
  renderDecisionInput,
  renderFileTree,
} from '@services/detection/decisions/input';
import {
  askDecisions,
  DECISIONS_MAX_QUESTIONS_PER_CALL,
} from '@services/detection/decisions/ask';
import {
  actionableAnswer,
  questionFacts,
  DECISIONS_KEY,
  decisionsTransport,
  getDecisions,
  runDecisionSpecs,
  summarizeAnswers,
} from '@services/detection/decisions/service';
import {
  decisionTraitWrites,
  rankProjectsWithDecisions,
  runDecisionsSource,
} from '@services/detection/decisions/traits';
import {
  DECISIONS_ACCEPT_PROBABILITY,
  DECISIONS_AGREE_PROBABILITY,
  routeIntegration,
} from '@services/detection/decisions/framework';
import { QUESTIONS } from '@services/detection/decisions/questions';
import {
  compareProjectReports,
  detectProjectsWithDecisions,
  judgeProjects,
} from '@services/detection/decisions/projects';
import type {
  DecisionAnswer,
  DecisionQuestionSpec,
} from '@services/detection/decisions/types';
import type { ProgramSession } from '@programs/program-contract';

// A cloud gateway origin: a pre-issued gateway has to be one the agent run would trust.
const GATEWAY = {
  gateway: { token: 'phs_test', url: 'https://ai-gateway.us.posthog.com' },
};

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
  state: Record<string, string>;
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
    /** The probability of every choice answer. */
    confidence?: number;
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
              confidence: options.confidence ?? 0.9,
              probabilities: { [choice]: options.confidence ?? 0.9 },
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

/** A decision state with one field filled; the rest empty. */
const state = (fileTree: string) => ({
  file_tree: fileTree,
  dependencies: '',
  lockfiles: '',
  env_key_names: '',
});

const predicate = (name: string): DecisionQuestionSpec => ({
  name,
  kind: 'predicate',
  instructions: `${name}?`,
  purpose: `test ${name}`,
});

describe('walkRepo', () => {
  it('records the tree, each manifest, lockfiles and env key names, never values', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { next: '15' } }),
      'apps/api/requirements.txt': 'django==5.0\nposthog\n',
      'pnpm-lock.yaml': 'lockfileVersion: 9',
      'apps/api/.env.local': 'DATABASE_URL=postgres://secret\n',
      'app/page.tsx': 'export default function Page() {}',
    });
    const snapshot = walkRepo(dir);
    expect(snapshot.files).toEqual(
      expect.arrayContaining(['package.json', 'app/page.tsx']),
    );
    expect(snapshot.manifests).toEqual(
      expect.arrayContaining([
        {
          path: 'package.json',
          dir: '.',
          ecosystem: 'npm',
          packages: ['next'],
        },
        {
          path: 'apps/api/requirements.txt',
          dir: 'apps/api',
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
  it('reads a package.json that starts with a byte order mark', () => {
    const dir = project({
      'package.json':
        '\uFEFF' + JSON.stringify({ dependencies: { next: '15' } }),
    });
    expect(walkRepo(dir).manifests).toMatchObject([
      { path: 'package.json', ecosystem: 'npm', packages: ['next'] },
    ]);
  });
});

describe('renderDecisionInput', () => {
  it('renders each fact as a section without file contents', () => {
    const input = renderDecisionInput(
      walkRepo(
        project({
          'package.json': JSON.stringify({ dependencies: { next: '15' } }),
          '.env': 'STRIPE_SECRET_KEY=sk_live_nope\n',
          'README.md': 'Private product notes',
        }),
      ),
    );
    expect(input).toContain('## file_tree');
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
    const result = await askDecisions(state('input'), specs, {
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
      'https://ai-gateway.us.posthog.com/v1/systemone',
    );
  });

  it('sends the redacted input, and nothing when the scanner cannot load', async () => {
    vi.mocked(redactSecretLines).mockResolvedValueOnce({
      text: '[redacted]',
      redactedLines: 1,
    });
    const fetchImpl = fakeGateway();
    const redacted = await askDecisions(state('KEY=sk_live'), specs, {
      transport: GATEWAY,
      fetchImpl,
    });
    const body = JSON.parse(
      String((fetchImpl.mock.calls[0][1] as Parameters<typeof fetch>[1])?.body),
    ) as GatewayBody;
    expect(body.state.file_tree).toBe('[redacted]');
    expect(redacted.redactedLines).toBe(1);

    vi.mocked(redactSecretLines).mockRejectedValueOnce(new Error('no wasm'));
    const blocked = fakeGateway();
    const failed = await askDecisions(state('input'), specs, {
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
    const result = await askDecisions(state('input'), many, {
      transport: GATEWAY,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.answers)).toHaveLength(
      DECISIONS_MAX_QUESTIONS_PER_CALL,
    );
    expect(result.unanswered).toHaveLength(3);
    expect(result.error).toMatch(/400/);
  });
});

describe('runProgramDecisions', () => {
  function session(overrides: Partial<ProgramSession> = {}): ProgramSession {
    return {
      installDir: project({
        'package.json': JSON.stringify({ dependencies: { next: '15' } }),
      }),
      // The run's flag lets Decisions ask.
      frameworkContext: { decisionsUse: 'traits' },
      credentials: { gateway: GATEWAY.gateway },
      discoveryConsent: DiscoveryConsent.Granted,
      noTelemetry: false,
      projects: [],
      runProject: '.',
      discoveredFeatures: [],
      mcpServerCandidates: [],
      integration: null,
      ...overrides,
    } as unknown as ProgramSession;
  }

  function ctx(sess: ProgramSession, fetchImpl: typeof fetch) {
    return {
      session: sess,
      setFrameworkContext: (key: string, value: unknown) => {
        sess.frameworkContext[key] = value;
      },
      programId: 'posthog-integration',
      fetchImpl,
    };
  }

  const specs = [
    predicate('uses_x'),
    { ...predicate('market'), shared: true as const },
  ];

  it('stores shadow answers that programs may not act on', async () => {
    const sess = session();
    await runDecisionSpecs(specs, ctx(sess, fakeGateway()));
    expect(getDecisions(sess)?.mode).toBe('shadow');
    expect(getDecisions(sess)?.answers.uses_x).toBeDefined();
    expect(actionableAnswer(sess, 'uses_x')).toBeUndefined();
  });

  it('asks nothing and stores nothing while the flag leaves Decisions off', async () => {
    const fetchImpl = fakeGateway();
    const sess = session({ frameworkContext: {} });
    expect(await runDecisionSpecs(specs, ctx(sess, fetchImpl))).toBeNull();
    expect(
      await runDecisionsSource(['calls_llm_api'], ctx(sess, fetchImpl)),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getDecisions(sess)).toBeUndefined();
  });

  it('leaves out shared questions when the user declined sharing', async () => {
    const fetchImpl = fakeGateway();
    const sess = session({ discoveryConsent: DiscoveryConsent.Declined });
    await runDecisionSpecs(specs, ctx(sess, fetchImpl));
    const body = JSON.parse(
      String((fetchImpl.mock.calls[0][1] as Parameters<typeof fetch>[1])?.body),
    ) as GatewayBody;
    expect(Object.keys(body.questions)).toEqual(['uses_x']);
  });

  it('records why nothing was asked without a login', async () => {
    const fetchImpl = fakeGateway();
    const sess = session({ credentials: null } as Partial<ProgramSession>);
    await runDecisionSpecs(specs, ctx(sess, fetchImpl));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      (sess.frameworkContext[DECISIONS_KEY] as { error: string }).error,
    ).toMatch(/no gateway token/);
  });

  describe('as a trait source', () => {
    const sink = (sess: ProgramSession) => ({
      session: sess,
      setProjects: (projects: ProgramSession['projects']) => {
        sess.projects = projects;
      },
    });

    it('writes nothing without a sink, so the answers reach only the log', async () => {
      const sess = session();
      await runDecisionsSource(['calls_llm_api'], ctx(sess, fakeGateway()));
      expect(getDecisions(sess)?.answers.calls_llm_api).toBeDefined();
      expect(sess.projects).toEqual([]);
    });

    it('writes its answers as traits of the run project', async () => {
      const sess = session();
      await runDecisionsSource(['calls_llm_api', 'web_frontend'], {
        ...ctx(sess, fakeGateway()),
        sink: sink(sess),
      });
      const claims = sess.projects.find((p) => p.path === '.')?.claims;
      for (const claim of [
        claims?.callsLlmApi?.[0],
        claims?.webFrontend?.[0],
      ]) {
        expect(claim).toMatchObject({ source: 'decisions' });
        expect(claim?.confidence).toBeGreaterThan(0);
      }
    });
  });
});

describe('decisionTraitWrites', () => {
  const answers = (probability: number): Record<string, DecisionAnswer> => ({
    calls_llm_api: { kind: 'predicate', probability },
    web_frontend: { kind: 'predicate', probability },
    is_mcp_server: { kind: 'predicate', probability },
    owns_database: { kind: 'predicate', probability },
  });

  it('reads a likely answer as yes, with its probability as confidence', () => {
    expect(decisionTraitWrites('apps/web', answers(0.9))).toEqual([
      {
        projectPath: 'apps/web',
        source: 'decisions',
        name: 'callsLlmApi',
        value: 'yes',
        confidence: 0.9,
      },
      {
        projectPath: 'apps/web',
        source: 'decisions',
        name: 'webFrontend',
        value: 'yes',
        confidence: 0.9,
      },
      {
        projectPath: 'apps/web',
        source: 'decisions',
        name: 'mcpServers',
        value: ['.'],
        confidence: 0.9,
      },
    ]);
  });

  it('reads an unlikely answer as no, and names no MCP server', () => {
    const writes = decisionTraitWrites('.', answers(0.05));
    expect(writes.map((write) => [write.name, write.value])).toEqual([
      ['callsLlmApi', 'no'],
      ['webFrontend', 'no'],
    ]);
    expect(writes[0].confidence).toBeCloseTo(0.95);
  });

  it('says nothing for an unsure answer', () => {
    expect(decisionTraitWrites('.', answers(0.4))).toEqual([]);
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
    const snapshot = walkRepo(
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
    const snapshot = walkRepo(project({ 'go.mod': 'module x' }));
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

describe('the folder paths a project judgment sends', () => {
  afterEach(() => {
    vi.mocked(redactSecretLines).mockImplementation((text: string) =>
      Promise.resolve({ text, redactedLines: 0 }),
    );
  });

  it('leaves out a folder whose path the secret filter flags, from the whole request', async () => {
    const TOKEN = 'phx_live_0123456789abcdef';
    // The filter replaces a whole line that holds a match, as the real one does.
    vi.mocked(redactSecretLines).mockImplementation((text: string) => {
      const lines = text.split('\n');
      const kept = lines.map((line) =>
        line.includes(TOKEN) ? '[redacted]' : line,
      );
      return Promise.resolve({
        text: kept.join('\n'),
        redactedLines: kept.filter((line, i) => line !== lines[i]).length,
      });
    });
    const fetchImpl = fakeGateway({
      choices: { project_0_target: 'nextjs', primary_app: 'apps/web' },
    });
    const judged = await judgeProjects(
      walkRepo(
        project({
          'apps/web/package.json': JSON.stringify({ dependencies: {} }),
          [`apps/${TOKEN}/package.json`]: JSON.stringify({ dependencies: {} }),
        }),
      ),
      GATEWAY,
      {
        targets: [{ id: 'nextjs', name: 'Next.js' }],
        recommend: true,
        fetchImpl,
      },
    );
    const sent = String(
      (fetchImpl.mock.calls[0][1] as Parameters<typeof fetch>[1])?.body,
    );
    expect(sent).not.toContain(TOKEN);
    expect(sent).toContain('apps/web');
    expect(judged?.report.projects.map((p) => p.path)).toEqual(['apps/web']);
  });

  it('sends nothing when the secret filter cannot load', async () => {
    vi.mocked(redactSecretLines).mockRejectedValue(new Error('no scanner'));
    const fetchImpl = fakeGateway();
    const onError = vi.fn();
    expect(
      await judgeProjects(
        walkRepo(project({ 'go.mod': 'module x' })),
        GATEWAY,
        {
          targets: [{ id: 'nextjs', name: 'Next.js' }],
          fetchImpl,
          onError,
        },
      ),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('nothing sent'),
    );
  });
});

describe('ranking projects as a trait source', () => {
  const monorepo = () =>
    project({
      'package.json': JSON.stringify({ workspaces: ['apps/*'] }),
      'apps/web/package.json': JSON.stringify({ dependencies: { next: '15' } }),
      'apps/api/requirements.txt': 'django\n',
    });

  function ranking(installDir: string, context: Record<string, unknown> = {}) {
    const session = {
      installDir,
      frameworkContext: { decisionsUse: 'traits', ...context },
      credentials: { gateway: GATEWAY.gateway },
      discoveryConsent: DiscoveryConsent.Granted,
      noTelemetry: false,
      projects: [],
      runProject: '.',
      discoveredFeatures: [],
      mcpServerCandidates: [],
      integration: null,
    } as unknown as ProgramSession;
    const sink = {
      session,
      setProjects: (projects: ProgramSession['projects']) => {
        session.projects = projects;
      },
    };
    const claims = (projectPath: string) =>
      session.projects.find((p) => p.path === projectPath)?.claims;
    return { session, sink, claims };
  }

  const ANSWERS = {
    project_0_target: 'none',
    project_1_target: 'django',
    project_2_target: 'nextjs',
    primary_app: 'apps/api',
  };

  it('writes each confident target and the main app as traits, with their probability', async () => {
    const { sink, claims } = ranking(monorepo());
    await rankProjectsWithDecisions(
      sink,
      'posthog-integration',
      fakeGateway({ choices: ANSWERS }),
    );
    expect(claims('apps/api')).toMatchObject({
      framework: [
        { value: Integration.django, source: 'decisions', confidence: 0.9 },
      ],
      mainApp: [{ value: 'yes', source: 'decisions' }],
    });
    expect(claims('apps/web')?.framework?.[0].value).toBe(Integration.nextjs);
    expect(claims('apps/web')?.mainApp).toBeUndefined();
  });

  it('writes nothing for a guess below the confidence threshold', async () => {
    const { session, sink } = ranking(monorepo());
    await rankProjectsWithDecisions(
      sink,
      'posthog-integration',
      fakeGateway({ choices: ANSWERS, confidence: 0.25 }),
    );
    expect(session.projects).toEqual([]);

    // One folder is the main app only when its own target is confident.
    const single = ranking(
      project({ 'package.json': JSON.stringify({ dependencies: {} }) }),
    );
    await rankProjectsWithDecisions(
      single.sink,
      'posthog-integration',
      fakeGateway({ choices: { project_0_target: 'nextjs' }, confidence: 0.4 }),
    );
    expect(single.session.projects).toEqual([]);
  });

  it('ranks the whole workspace when the run started in one member of it', async () => {
    const root = monorepo();
    const { session, sink, claims } = ranking(path.join(root, 'apps/web'), {
      // What discovery leaves with the flag on: the walk of the workspace root.
      discovery: {
        rootDir: root,
        files: walkRepo(root),
        mode: 'one-project',
        runProject: 'apps/web',
        detected: {},
        projects: { workspaces: [] },
      },
    });
    session.runProject = 'apps/web';
    const fetchImpl = fakeGateway({ choices: ANSWERS });
    await rankProjectsWithDecisions(sink, 'posthog-integration', fetchImpl);

    // Paths are from the workspace root, and the sibling is ranked too.
    expect(session.projects.map((p) => p.path).sort()).toEqual([
      'apps/api',
      'apps/web',
    ]);
    expect(claims('apps/api')?.mainApp?.[0].value).toBe('yes');
    expect(claims('apps/web')?.mainApp).toBeUndefined();
  });

  it('asks the same question of the same walk once in a run', async () => {
    const dir = monorepo();
    const { session } = ranking(dir);
    // One walk, as a run holds: the trait source and the agent scan's comparison both judge it.
    const scan = walkRepo(dir);
    const gateway = fakeGateway({ choices: ANSWERS });
    vi.stubGlobal('fetch', gateway);
    try {
      const options = {
        targets: [{ id: 'nextjs', name: 'Next.js' }],
        programId: 'posthog-integration',
        recommend: true,
      };
      const first = await detectProjectsWithDecisions(session, options, scan);
      const second = await detectProjectsWithDecisions(session, options, scan);
      expect(first).not.toBeNull();
      expect(second).toBe(first);
      expect(gateway).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('judgeProjects with one folder', () => {
  it('recommends it without asking a one-value choice', async () => {
    const fetchImpl = fakeGateway({ choices: { project_0_target: 'nextjs' } });
    const judged = await judgeProjects(
      walkRepo(
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
  const login = {
    accessToken: 'pha_oauth',
    host: { region: 'us', apiHost: 'https://us.posthog.com' },
  };

  beforeEach(() => {
    vi.mocked(gatewayAuth).mockReset();
  });

  const ON = { frameworkContext: { decisionsUse: 'compare' } };

  it("uses the run's pre-issued key without minting", async () => {
    const session = {
      ...ON,
      credentials: { ...login, gateway: GATEWAY.gateway },
    } as unknown as ProgramSession;
    expect(await decisionsTransport(session, 'metrics')).toEqual(GATEWAY);
    expect(gatewayAuth).not.toHaveBeenCalled();
  });

  it('gives no transport, and so sends nothing, while the flag leaves Decisions off', async () => {
    for (const frameworkContext of [{}, { decisionsUse: 'off' }]) {
      const session = {
        frameworkContext,
        credentials: { ...login, gateway: GATEWAY.gateway },
      } as unknown as ProgramSession;
      expect(await decisionsTransport(session, 'metrics')).toBeNull();
    }
    expect(gatewayAuth).not.toHaveBeenCalled();
  });

  it.each([
    'https://gateway.attacker.test',
    'http://ai-gateway.us.posthog.com',
    'https://ai-gateway.us.posthog.com/v1',
    'not a url',
  ])(
    'sends nothing to a pre-issued gateway that is no trusted origin: %s',
    async (url) => {
      const session = {
        ...ON,
        credentials: { ...login, gateway: { token: 'phs_test', url } },
      } as unknown as ProgramSession;
      expect(await decisionsTransport(session, 'metrics')).toBeNull();
      expect(gatewayAuth).not.toHaveBeenCalled();
    },
  );

  it('mints a token for the program, as the agents do', async () => {
    vi.mocked(gatewayAuth).mockResolvedValue({
      gatewayUrl: 'https://gateway.test',
      token: 'phs_minted',
      refreshAtMs: 0,
    });
    const session = { ...ON, credentials: login } as unknown as ProgramSession;
    expect(await decisionsTransport(session, 'metrics')).toEqual({
      gateway: { token: 'phs_minted', url: 'https://gateway.test' },
    });
    expect(gatewayAuth).toHaveBeenCalledWith(
      login.host,
      login.accessToken,
      'metrics',
    );
  });

  it('has no transport without a login, or when the mint fails', async () => {
    const loggedOut = { ...ON, credentials: null } as unknown as ProgramSession;
    expect(await decisionsTransport(loggedOut, 'metrics')).toBeNull();

    vi.mocked(gatewayAuth).mockRejectedValue(new Error('mint refused'));
    const session = { ...ON, credentials: login } as unknown as ProgramSession;
    expect(await decisionsTransport(session, 'metrics')).toBeNull();
  });
});
