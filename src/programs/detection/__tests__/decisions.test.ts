import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Integration } from '@shared/constants';
import {
  AI_KINDS,
  AI_PREFIX,
  DECISION_QUESTIONS,
  FRAMEWORK_CRITERIA,
  NO_FRAMEWORK,
  PRESENCE_LANGUAGES,
  PRESENCE_QUESTIONS,
  VARIANT_BY_INTEGRATION,
  VARIANT_QUESTIONS,
  WAREHOUSE_KINDS,
  WAREHOUSE_PREFIX,
  integrationFromChoice,
  variantKeyFor,
} from '@programs/detection/decisions/questions';
import {
  AI_SOURCE_KINDS,
  CORE_SOURCE_KINDS,
} from '@programs/warehouse-sources/registry';
import {
  routeIntegration,
  DECISIONS_ACCEPT_PROBABILITY,
  DECISIONS_AGREE_PROBABILITY,
} from '@programs/detection/decisions/route';
import {
  renderDecisionInput,
  renderFileTree,
  scanProject,
} from '@programs/detection/decisions/state';
import {
  answersByName,
  chunkQuestions,
  classify,
  detectWithDecisions,
} from '@programs/detection/decisions/index';
import {
  createDecision,
  type Decision,
  type DecisionAnswer,
  type DecisionQuestion,
} from '@programs/detection/decisions/client';

describe('question catalog', () => {
  it('covers every Integration plus the none value, nothing else', () => {
    expect(new Set(Object.keys(FRAMEWORK_CRITERIA))).toEqual(
      new Set<string>([...Object.values(Integration), NO_FRAMEWORK]),
    );
  });

  it('names every question uniquely and puts framework first', () => {
    const names = DECISION_QUESTIONS.map((q) => q.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names[0]).toBe('framework');
  });

  it('maps every variant to a real question and Integration', () => {
    for (const [integration, key] of Object.entries(VARIANT_BY_INTEGRATION)) {
      expect(Object.values(Integration)).toContain(integration);
      expect(Object.keys(VARIANT_QUESTIONS)).toContain(key);
    }
    expect(variantKeyFor(Integration.tanstackStart)).toBe(
      'tanstack_router_mode',
    );
    expect(variantKeyFor(Integration.django)).toBeUndefined();
    expect(variantKeyFor(null)).toBeUndefined();
  });

  it('maps choice values back to Integrations', () => {
    expect(integrationFromChoice('react-router')).toBe(Integration.reactRouter);
    expect(integrationFromChoice(NO_FRAMEWORK)).toBeNull();
    expect(integrationFromChoice('not-a-framework')).toBeNull();
  });

  it('asks presence for every Integration and language', () => {
    const names = PRESENCE_QUESTIONS.map((q) => q.name);
    for (const integration of Object.values(Integration)) {
      expect(names).toContain(`fw_${integration}`);
    }
    for (const language of PRESENCE_LANGUAGES) {
      expect(names).toContain(`lang_${language}`);
    }
  });

  it('asks about every core and AI registry kind once', () => {
    expect(new Set(WAREHOUSE_KINDS)).toEqual(new Set(CORE_SOURCE_KINDS));
    expect(new Set(AI_KINDS)).toEqual(new Set(AI_SOURCE_KINDS));
    const sourceNames = DECISION_QUESTIONS.filter(
      (q) =>
        q.name.startsWith(WAREHOUSE_PREFIX) || q.name.startsWith(AI_PREFIX),
    );
    expect(sourceNames).toHaveLength(WAREHOUSE_KINDS.length + AI_KINDS.length);
  });
});

function choiceAnswer(
  name: string,
  probabilities: Record<string, number>,
): DecisionAnswer {
  const [choice] = Object.entries(probabilities).sort(
    ([, a], [, b]) => b - a,
  )[0];
  return {
    type: 'choice',
    name,
    choice,
    confidence: 1,
    probabilities: Object.entries(probabilities).map(
      ([value, probability]) => ({
        value,
        probability,
      }),
    ),
  };
}

function decisionFor(
  questions: readonly DecisionQuestion[],
  answer: (q: DecisionQuestion) => DecisionAnswer,
): Decision {
  return {
    answers: questions.map(answer),
    model: 'gpt-6-luna',
    usage: {
      input_tokens: 1000,
      output_tokens: 0,
      total_tokens: 1000,
      input_tokens_details: { cached_tokens: 0 },
    },
  };
}

function defaultAnswer(q: DecisionQuestion): DecisionAnswer {
  if (q.name === 'framework') {
    return choiceAnswer('framework', { nextjs: 0.9, 'react-router': 0.1 });
  }
  if (q.name === 'nextjs_router') {
    return choiceAnswer('nextjs_router', {
      app_router: 0.7,
      pages_router: 0.3,
    });
  }
  if (q.type === 'choice') {
    return choiceAnswer(q.name, { [q.choices[0].value]: 1 });
  }
  return { type: 'predicate', name: q.name, probability: 0.25 };
}

describe('answer mapping', () => {
  it('pairs answers by position and rejects a mismatched name', () => {
    const questions = DECISION_QUESTIONS.slice(0, 3);
    const decision = decisionFor(questions, defaultAnswer);
    expect([...answersByName(questions, decision).keys()]).toEqual(
      questions.map((q) => q.name),
    );

    decision.answers[1] = { type: 'refusal', name: 'something_else' };
    expect(() => answersByName(questions, decision)).toThrow(/expected/);
  });

  it('accepts unnamed answers and rejects a short answer list', () => {
    const questions = DECISION_QUESTIONS.slice(0, 2);
    const decision = decisionFor(questions, (q) => ({
      ...defaultAnswer(q),
      name: null,
    }));
    expect(answersByName(questions, decision).size).toBe(2);
    decision.answers.pop();
    expect(() => answersByName(questions, decision)).toThrow(/answers for/);
  });

  it('builds the report, reading probability from the distribution', () => {
    const questions = DECISION_QUESTIONS;
    const answers = answersByName(
      questions,
      decisionFor(questions, defaultAnswer),
    );
    const report = classify(answers);
    expect(report.framework).toMatchObject({
      choice: 'nextjs',
      integration: Integration.nextjs,
      probability: 0.9,
      confidence: 1,
    });
    expect(report.variant).toMatchObject({
      key: 'nextjs_router',
      choice: 'app_router',
      probability: 0.7,
    });
    expect(report.signals.isMonorepo).toBe(0.25);
    expect(Object.keys(report.warehouseSources)).toHaveLength(
      WAREHOUSE_KINDS.length,
    );
    expect(report.unanswered).toEqual([]);
  });

  it('reports refusals as unanswered and null', () => {
    const answers = new Map<string, DecisionAnswer>([
      ['framework', { type: 'refusal', name: 'framework' }],
      ['is_monorepo', { type: 'refusal', name: 'is_monorepo' }],
    ]);
    const report = classify(answers);
    expect(report.framework).toBeNull();
    expect(report.variant).toBeNull();
    expect(report.signals.isMonorepo).toBeNull();
    expect(report.unanswered).toContain('framework');
    expect(report.unanswered).toHaveLength(DECISION_QUESTIONS.length);
  });

  it('chunks questions in order', () => {
    expect(chunkQuestions([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('detectWithDecisions', () => {
  const originalKey = process.env.OPENAI_API_KEY;
  let dir: string;
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-decisions-'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { next: '15.0.0' } }),
    );
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function fakeFetch(failBatch?: number) {
    let call = 0;
    return vi.fn(
      (_url: string | URL | Request, init?: Parameters<typeof fetch>[1]) => {
        const index = call++;
        if (index === failBatch) {
          return Promise.resolve(new Response('bad request', { status: 400 }));
        }
        const body = JSON.parse(String(init?.body)) as {
          questions: DecisionQuestion[];
        };
        return Promise.resolve(
          Response.json(decisionFor(body.questions, defaultAnswer)),
        );
      },
    ) as unknown as typeof fetch;
  }

  it('splits questions across calls and merges usage', async () => {
    const fetchImpl = fakeFetch();
    const report = await detectWithDecisions(dir, {
      fetchImpl,
      maxQuestionsPerCall: 40,
    });
    const calls = Math.ceil(DECISION_QUESTIONS.length / 40);
    expect(fetchImpl).toHaveBeenCalledTimes(calls);
    expect(report.calls).toBe(calls);
    expect(report.usage.inputTokens).toBe(calls * 1000);
    expect(report.framework?.integration).toBe(Integration.nextjs);
  });

  it('keeps the report when a later batch fails', async () => {
    const report = await detectWithDecisions(dir, {
      fetchImpl: fakeFetch(1),
      maxQuestionsPerCall: 40,
    });
    expect(report.failedCalls).toBe(1);
    expect(report.framework?.choice).toBe('nextjs');
    expect(report.unanswered.length).toBeGreaterThan(0);
  });

  it('throws when the framework batch fails', async () => {
    await expect(
      detectWithDecisions(dir, { fetchImpl: fakeFetch(0) }),
    ).rejects.toThrow(/HTTP 400/);
  });

  it('throws without an API key', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(detectWithDecisions(dir)).rejects.toThrow(/OPENAI_API_KEY/);
  });
});

describe('createDecision', () => {
  const params = { model: 'gpt-6-luna', input: 'x', questions: [] };

  it('retries a transient status once', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ answers: [], model: 'gpt-6-luna', usage: {} }),
      );
    await createDecision(params, { apiKey: 'k', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0] as [
      string,
      Parameters<typeof fetch>[1],
    ];
    expect(url).toBe('https://api.openai.com/v1/decisions');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer k');
  });

  it('does not retry a client error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('nope', { status: 401 }));
    await expect(
      createDecision(params, { apiKey: 'k', fetchImpl }),
    ).rejects.toThrow(/HTTP 401/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('routeIntegration', () => {
  const answer = (integration: Integration | null, probability: number) => ({
    integration,
    probability,
  });

  it('falls back to static when decisions failed or abstained', () => {
    expect(routeIntegration(null, Integration.nextjs)).toEqual({
      integration: Integration.nextjs,
      source: 'static',
    });
    expect(routeIntegration(answer(null, 0.99), Integration.nextjs)).toEqual({
      integration: Integration.nextjs,
      source: 'static',
    });
  });

  it('accepts decisions outright at the accept gate', () => {
    expect(
      routeIntegration(
        answer(Integration.astro, DECISIONS_ACCEPT_PROBABILITY),
        Integration.javascriptNode,
      ),
    ).toEqual({ integration: Integration.astro, source: 'decisions' });
  });

  it('needs static agreement or a static miss in the middle band', () => {
    const mid = DECISIONS_AGREE_PROBABILITY;
    expect(routeIntegration(answer(Integration.astro, mid), undefined)).toEqual(
      { integration: Integration.astro, source: 'decisions' },
    );
    expect(
      routeIntegration(answer(Integration.astro, mid), Integration.nextjs),
    ).toEqual({ integration: Integration.nextjs, source: 'static' });
  });

  it('lets static decide below the agree gate', () => {
    expect(
      routeIntegration(
        answer(Integration.astro, DECISIONS_AGREE_PROBABILITY - 0.01),
        undefined,
      ),
    ).toEqual({ integration: undefined, source: 'static' });
  });
});

describe('renderFileTree', () => {
  it('renders nested paths as an indented tree', () => {
    expect(renderFileTree(['a.txt', 'src/b.ts', 'src/lib/c.ts'])).toBe(
      ['a.txt', 'src/', '  b.ts', '  lib/', '    c.ts'].join('\n'),
    );
  });

  it('caps entries per directory with a legible remainder', () => {
    const files = Array.from({ length: 8 }, (_, i) => `f${i}.ts`);
    const tree = renderFileTree(files, { maxEntriesPerDir: 5 });
    expect(tree.split('\n')).toHaveLength(6);
    expect(tree).toContain('… +3 more files');
  });

  it('caps total lines and marks truncation', () => {
    const files = Array.from({ length: 50 }, (_, i) => `d${i}/f.ts`);
    const tree = renderFileTree(files, { maxLines: 10, maxEntriesPerDir: 100 });
    expect(tree.split('\n').length).toBeLessThanOrEqual(11);
    expect(tree).toContain('(tree truncated)');
  });
});

describe('scanProject', () => {
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

  it('collects tree, trimmed manifests, lockfiles and readme head, never .env', () => {
    const dir = project({
      'package.json': JSON.stringify({
        name: 'demo',
        dependencies: { next: '15.0.0' },
        description: 'dropped by trimming',
      }),
      'pnpm-lock.yaml': 'lockfileVersion: 9',
      'README.md': '# Demo app',
      'app/page.tsx': 'export default function Page() {}',
      '.env': 'SECRET=nope',
    });
    const { state } = scanProject(dir);
    expect(state.file_tree).toContain('page.tsx');
    expect(state.lockfiles).toEqual(['pnpm-lock.yaml']);
    expect(state.readme_head).toBe('# Demo app');
    const pkg = JSON.parse(state.manifests['package.json']) as Record<
      string,
      unknown
    >;
    expect(pkg.dependencies).toEqual({ next: '15.0.0' });
    expect(pkg).not.toHaveProperty('description');

    const input = JSON.stringify(renderDecisionInput(state));
    expect(input).toContain('## Manifest: package.json');
    expect(input).not.toContain('SECRET=nope');
  });

  it('lists manifest-bearing subdirectories for descent, root excluded', () => {
    const { subprojectDirs } = scanProject(
      project({
        'package.json': '{"name":"root","workspaces":["apps/*"]}',
        'apps/web/package.json': '{"name":"web"}',
        'apps/api/package.json': '{"name":"api"}',
        'services/worker/go.mod': 'module worker',
        'apps/web/src/index.ts': '',
      }),
    );
    expect(subprojectDirs).toEqual(
      expect.arrayContaining(['apps/web', 'apps/api', 'services/worker']),
    );
    expect(subprojectDirs).not.toContain('.');
    expect(subprojectDirs).not.toContain('apps/web/src');
  });

  it('prefers shallow manifests when capping', () => {
    const files: Record<string, string> = { 'package.json': '{"name":"root"}' };
    for (let i = 0; i < 30; i++) {
      files[
        `packages/p${String(i).padStart(2, '0')}/package.json`
      ] = `{"name":"p${i}"}`;
    }
    const { state } = scanProject(project(files));
    expect(Object.keys(state.manifests)[0]).toBe('package.json');
    expect(Object.keys(state.manifests).length).toBeLessThanOrEqual(20);
  });
});
