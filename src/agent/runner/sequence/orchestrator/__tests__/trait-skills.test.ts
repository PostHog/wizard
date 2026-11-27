/** Coverage for trait-skills installation and orchestrator SDK trait skill wiring. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { zipSync } from 'fflate';
import type { SkillEntry } from '@shared/skill-menu';

let yaraScanResult: string | null = null;
let yaraRejectOnlySdk = false;
const seenProviders: unknown[] = [];

vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
  },
}));
vi.mock('@utils/debug', () => ({
  logToFile: vi.fn(),
}));
vi.mock('@agent/yara-hooks', async (importActual) => ({
  ...(await importActual<typeof import('@agent/yara-hooks')>()),
  scanInstalledSkill: (dir: string, triageProvider?: unknown) => {
    seenProviders.push(triageProvider);
    if (yaraRejectOnlySdk && !dir.includes('sdk-posthog-node-v5')) {
      return Promise.resolve(null);
    }
    return Promise.resolve(yaraScanResult);
  },
}));
vi.mock('../../../switchboard', async () => {
  const { VALID_MODELS } = await import('../../../switchboard/models');
  return {
    resolveHarness: () => ({ harness: 'pi', model: [...VALID_MODELS][0] }),
    resolveStageOverrides: () => ({}),
    getHarness: () => ({ runTask: (inputs: unknown) => harnessRun(inputs) }),
  };
});

import { analytics } from '@utils/analytics';
import { RunOutcome, type SequenceContext } from '../../../shared/types';
import { installTraitSkills } from '../../../shared/trait-skills';
import { runOrchestrator } from '../orchestrator-runner';
import type { QueueStore } from '../queue';

const entry = (id: string, rest: Partial<SkillEntry> = {}): SkillEntry => ({
  id,
  name: id,
  family: id,
  downloadUrl: `https://skills.test/${id}.zip`,
  ...rest,
});

const sdkZip = zipSync({
  'SKILL.md': new TextEncoder().encode('# PostHog Node 5.x\nKeep 5.x.\n'),
});

type TaskInputs = {
  prompt?: string;
  analyticsProperties: { task_type: string; task_id?: string };
  orchestrator: { store: QueueStore };
};

let seenTaskPrompt = '';

function harnessRun(raw: unknown) {
  const inputs = raw as TaskInputs;
  const { store } = inputs.orchestrator;
  const type = inputs.analyticsProperties.task_type;
  if (type === 'seed') {
    store.enqueue({ type: 'install' });
  } else {
    seenTaskPrompt = inputs.prompt ?? '';
    store.complete(inputs.analyticsProperties.task_id as string);
  }
  return Promise.resolve({ kind: 'success' as const });
}

function mockMenuAndZip() {
  const menu = {
    categories: {
      skills: [
        entry('integration-nextjs', {
          family: 'integration',
          tags: ['framework:nextjs', 'default'],
        }),
        entry('install-deps', {
          family: 'install-deps',
          tags: ['framework:nextjs', 'default'],
        }),
      ],
      'sdk/posthog-node': [
        entry('sdk-posthog-node-v5', {
          family: 'sdk-posthog-node',
          tags: ['posthogSdks:posthog-node@4', 'posthogSdks:posthog-node@5'],
        }),
        entry('sdk-posthog-node-v6', {
          family: 'sdk-posthog-node',
          tags: ['posthogSdks:posthog-node@6', 'default'],
        }),
      ],
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((target: string | URL | Request) => {
      const url = typeof target === 'string' ? target : target.toString();
      if (url.endsWith('/skill-menu.json')) {
        return Promise.resolve(
          new Response(JSON.stringify(menu), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(new Response(sdkZip, { status: 200 }));
    }),
  );
  return Object.values(menu.categories).flat();
}

describe('installTraitSkills', () => {
  let dir = '';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trait-skills-'));
    yaraScanResult = null;
    seenProviders.length = 0;
    vi.mocked(analytics.wizardCapture).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('forwards triageProvider and fails open on YARA rejection', async () => {
    const entries = mockMenuAndZip();
    const provider = { name: 'mock-provider' } as never;
    yaraScanResult = 'poisoned: prompt-injection';

    const result = await installTraitSkills({
      entries,
      matchKeys: { posthogSdks: ['posthog-node@5'] },
      installDir: dir,
      triageProvider: provider,
    });

    expect(result).toEqual({ paths: [], aborted: false });
    expect(seenProviders).toEqual([provider]);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'sdk trait skill resolved',
      { skill_id: 'sdk-posthog-node-v5', installed: false },
    );
  });

  it('returns aborted when signal is already aborted', async () => {
    const entries = mockMenuAndZip();
    const ac = new AbortController();
    ac.abort();

    const aborted = await installTraitSkills({
      entries,
      matchKeys: { posthogSdks: ['posthog-node@5'] },
      installDir: dir,
      triageProvider: undefined,
      signal: ac.signal,
    });
    expect(aborted).toEqual({ paths: [], aborted: true });
  });
});

describe('runOrchestrator with trait SDK skills', () => {
  let dir = '';

  const makeContext = (orchProvider: unknown) =>
    ({
      config: {
        programId: 'flow',
        run: { integrationLabel: 'flow' },
        wizardFlags: {},
        wizardFlagPayloads: {},
        switchboard: {},
        agentPrompts: () =>
          Promise.resolve({
            seed: '---\nseed: true\n---\nseed',
            install: '---\nskills: [install-deps]\nsink: true\n---\ninstall',
          }),
        matchKeys: () => ({
          framework: ['nextjs'],
          posthogSdks: ['posthog-node@5'],
        }),
      },
      input: { installDir: dir, flags: { ci: true } },
      boot: {
        skillsBaseUrl: 'https://skills.test',
        wizardFlags: {},
        triageProvider: orchProvider,
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

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-trait-skills-'));
    yaraScanResult = null;
    yaraRejectOnlySdk = false;
    seenProviders.length = 0;
    seenTaskPrompt = '';
    vi.mocked(analytics.wizardCapture).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('installs matching SDK trait skills into .claude/skills, forwards triageProvider, and injects sdkSkillPaths into task prompts', async () => {
    mockMenuAndZip();
    const orchProvider = { name: 'orch-triage-provider' } as never;

    const result = await runOrchestrator(makeContext(orchProvider));

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(seenProviders).toContain(orchProvider);
    expect(seenTaskPrompt).toContain(
      path.join('.claude', 'skills', 'sdk-posthog-node-v5', 'SKILL.md'),
    );
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'sdk trait skill resolved',
      { skill_id: 'sdk-posthog-node-v5', installed: true },
    );
  });

  it('continues the run without sdkSkillPaths when a matched SDK trait skill fails to install', async () => {
    mockMenuAndZip();
    yaraScanResult = 'poisoned: prompt-injection';
    yaraRejectOnlySdk = true;

    const result = await runOrchestrator(makeContext(undefined));

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(seenTaskPrompt).not.toContain('sdk-posthog-node-v5');
  });
});
