/** Coverage for trait-skills helpers and orchestrator SDK trait skill installation. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { zipSync } from 'fflate';
import type { SkillEntry } from '@shared/skill-menu';

let yaraScanResult: string | null = null;
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
  scanInstalledSkill: (_dir: string, triageProvider?: unknown) => {
    seenProviders.push(triageProvider);
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
import { logToFile } from '@utils/debug';
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

function mockMenuAndZip({ zipStatus = 200 }: { zipStatus?: number } = {}) {
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
  const fetchMock = vi.fn((target: string | URL | Request) => {
    const url = typeof target === 'string' ? target : target.toString();
    if (url.endsWith('/skill-menu.json')) {
      return Promise.resolve(
        new Response(JSON.stringify(menu), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    if (zipStatus !== 200) {
      return Promise.resolve(new Response('not found', { status: zipStatus }));
    }
    return Promise.resolve(new Response(sdkZip, { status: 200 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return Object.values(menu.categories).flat();
}

describe('installTraitSkills', () => {
  let dir = '';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trait-skills-'));
    yaraScanResult = null;
    seenProviders.length = 0;
    vi.mocked(analytics.wizardCapture).mockClear();
    vi.mocked(logToFile).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('forwards triageProvider, logs non-undefined errors, and captures YARA rejections', async () => {
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
    expect(vi.mocked(logToFile)).not.toHaveBeenCalledWith(
      expect.stringContaining('undefined'),
    );
  });

  it('returns aborted when signal triggers during installation, allows symlinked root installDir, and refuses symlinked cache segments', async () => {
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

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'trait-out-'));
    try {
      const symDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trait-sym-'));
      const symSubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trait-sub-'));
      const linkParent = fs.mkdtempSync(path.join(os.tmpdir(), 'trait-link-'));
      const symRoot = path.join(linkParent, 'repo-link');
      try {
        fs.symlinkSync(outside, path.join(symDir, '.posthog-wizard-cache'));
        const blocked = await installTraitSkills({
          entries,
          matchKeys: { posthogSdks: ['posthog-node@5'] },
          installDir: symDir,
          triageProvider: undefined,
        });
        expect(blocked).toEqual({ paths: [], aborted: false });
        expect(fs.existsSync(path.join(outside, 'sdk'))).toBe(false);

        // Symlinked `.posthog-wizard-cache/sdk` child under a real cache dir must also be rejected.
        fs.mkdirSync(path.join(symSubDir, '.posthog-wizard-cache'), {
          recursive: true,
        });
        fs.symlinkSync(
          outside,
          path.join(symSubDir, '.posthog-wizard-cache', 'sdk'),
        );
        const blockedSub = await installTraitSkills({
          entries,
          matchKeys: { posthogSdks: ['posthog-node@5'] },
          installDir: symSubDir,
          triageProvider: undefined,
        });
        expect(blockedSub).toEqual({ paths: [], aborted: false });
        expect(fs.existsSync(path.join(outside, 'sdk-posthog-node-v5'))).toBe(
          false,
        );

        // A symlinked root installDir itself is allowed when cache segments inside it are real dirs.
        fs.symlinkSync(dir, symRoot);
        const fromSymRoot = await installTraitSkills({
          entries,
          matchKeys: { posthogSdks: ['posthog-node@5'] },
          installDir: symRoot,
          triageProvider: undefined,
        });
        expect(fromSymRoot.aborted).toBe(false);
        expect(fromSymRoot.paths).toEqual([
          path.join(
            '.posthog-wizard-cache',
            'sdk',
            'sdk-posthog-node-v5',
            'SKILL.md',
          ),
        ]);
      } finally {
        fs.rmSync(symDir, { recursive: true, force: true });
        fs.rmSync(symSubDir, { recursive: true, force: true });
        fs.rmSync(linkParent, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('runOrchestrator with trait SDK skills', () => {
  let dir = '';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-trait-skills-'));
    yaraScanResult = null;
    seenTaskPrompt = '';
    vi.mocked(analytics.wizardCapture).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('installs matching SDK trait skills alongside framework skills, forwards triageProvider, and injects sdkSkillPaths into task prompts', async () => {
    mockMenuAndZip();
    const orchProvider = { name: 'orch-triage-provider' } as never;
    const prompts: Record<string, string> = {
      seed: '---\nseed: true\n---\nseed',
      install: '---\nskills: [install-deps]\nsink: true\n---\ninstall',
    };

    const result = await runOrchestrator({
      config: {
        programId: 'flow',
        wizardFlags: {},
        wizardFlagPayloads: {},
        switchboard: {},
        agentPrompts: () => Promise.resolve(prompts),
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

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(seenProviders).toContain(orchProvider);
    expect(seenTaskPrompt).toContain(
      path.join(
        '.posthog-wizard-cache',
        'sdk',
        'sdk-posthog-node-v5',
        'SKILL.md',
      ),
    );
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'sdk trait skill resolved',
      { skill_id: 'sdk-posthog-node-v5', installed: true },
    );
  });
});
