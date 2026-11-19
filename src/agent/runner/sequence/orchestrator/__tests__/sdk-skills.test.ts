/** Orchestrator preflight + task prompt wiring for exact-major SDK skills. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
  },
}));
const writeMockSkill = (
  id: string,
  installDir: string,
  skillsRoot = '.claude/skills',
): string | undefined => {
  installs.push(id);
  const files = skills[id];
  if (!files) return undefined;
  const relative = `${skillsRoot}/${id}`;
  for (const [file, contents] of Object.entries(files)) {
    const target = path.join(installDir, relative, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return relative;
};

const menuFetchMock = vi.fn(() => Promise.resolve(menu));
vi.mock('@shared/skill-menu', () => ({
  fetchSkillMenu: () => menuFetchMock(),
}));
vi.mock('@shared/skill-install', async (importActual) => ({
  ...(await importActual<typeof import('@shared/skill-install')>()),
  downloadSkill: (
    entry: { id: string },
    installDir: string,
    options: { skillsRoot?: string },
  ) => {
    const relative = writeMockSkill(entry.id, installDir, options.skillsRoot);
    return Promise.resolve(
      relative ? { success: true } : { success: false, error: 'not-found' },
    );
  },
  installSkillById: (
    id: string,
    installDir: string,
    _url: string,
    options: { skillsRoot: string },
  ) => {
    const relative = writeMockSkill(id, installDir, options.skillsRoot);
    return Promise.resolve(
      relative
        ? { kind: 'ok', path: relative }
        : { kind: 'skill-not-found', skillId: id },
    );
  },
}));
vi.mock('../../../switchboard', async () => {
  const { VALID_MODELS } = await import('../../../switchboard/models');
  return {
    resolveHarness: () => ({ harness: 'pi', model: [...VALID_MODELS][0] }),
    resolveStageOverrides: () => ({}),
    areSeededTasksEnabled: () => false,
    getHarness: () => ({ runTask: (inputs: unknown) => harnessRun(inputs) }),
  };
});

import { RunOutcome } from '../../../shared/types';
import { runOrchestrator } from '../orchestrator-runner';
import type { SequenceContext } from '../../../shared/types';
import type { QueueStore } from '../queue';
import type { MatchKeys } from '@shared/skill-resolution';
import {
  installPlannedSdkSkills,
  noSkillFact,
  planSdkSkillInstalls,
  registerWizardCacheCleanup,
  SDK_SKILLS_ROOT,
} from '../../../shared/sdk-skills';

const FLOW: Record<string, string> = {
  install: '---\nskills: []\ndependsOn: []\n---\ninstall',
  report: '---\nsink: true\nskills: []\ndependsOn: [install]\n---\nreport',
};

const entry = (id: string, rest: object = {}) => ({
  id,
  name: id,
  family: id,
  downloadUrl: `https://skills.test/${id}.zip`,
  ...rest,
});

const menu = {
  categories: {
    integration: [
      entry('integration-fastapi', {
        family: 'integration',
        tags: ['framework:fastapi', 'default'],
      }),
    ],
    'sdk/posthog-python': [
      entry('sdk-posthog-python-v7', {
        family: 'sdk-posthog-python',
        tags: ['sdk-python-7', 'sdkPython:7', 'sdk-posthog-python'],
      }),
      entry('sdk-posthog-python-v8', {
        family: 'sdk-posthog-python',
        tags: ['sdk-python-8', 'sdkPython:8', 'sdk-posthog-python', 'default'],
      }),
    ],
  },
};

const skills: Record<string, Record<string, string>> = {
  'integration-fastapi': {
    'SKILL.md': 'pack',
    'references/EXAMPLE.md': '# 8.x example',
    'references/COMMANDMENTS.md': 'rules',
  },
  'sdk-posthog-python-v7': {
    'SKILL.md': '# Python 7.x.x\nSpot search 7.x.x.md only.',
  },
  'sdk-posthog-python-v8': {
    'SKILL.md': '# Python 8.x.x\nSpot search 8.x.x.md only.',
  },
  'sdk-posthog-python-legacy': {
    'SKILL.md': '# Python 5 to 7\nCovers every major from 5 to 7.',
  },
};

// One entry carries one tag per major it covers.
const multiTagMenu = {
  categories: {
    ...menu.categories,
    'sdk/posthog-python': [
      entry('sdk-posthog-python-legacy', {
        family: 'sdk-posthog-python',
        tags: [
          'sdk-posthog-python',
          'sdkPython:5',
          'sdkPython:6',
          'sdkPython:7',
        ],
      }),
      menu.categories['sdk/posthog-python'][1],
    ],
  },
};

type Inputs = {
  prompt: string;
  emit: (event: { kind: 'handoff'; text: string }) => void;
  analyticsProperties: { task_type: string; task_id?: string };
  orchestrator: { store: QueueStore };
};

let installs: string[] = [];
let prompts: Record<string, string> = {};
let dir = '';

function harnessRun(raw: unknown) {
  const inputs = raw as Inputs;
  const { store } = inputs.orchestrator;
  const type = inputs.analyticsProperties.task_type;
  prompts[type] = inputs.prompt;
  if (type === 'seed') {
    const install = store.enqueue({ type: 'install' });
    store.enqueue({ type: 'report', dependsOn: [install.id] });
  } else {
    if (type === 'report') inputs.emit({ kind: 'handoff', text: '# Report' });
    store.complete(inputs.analyticsProperties.task_id as string);
  }
  return Promise.resolve({ kind: 'success' as const });
}

describe('orchestrator SDK major skills', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-sdk-'));
    installs = [];
    prompts = {};
    menuFetchMock.mockClear();
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const runWithKeys = (
    matchKeys: MatchKeys,
    opts?: { installSdkSkills?: boolean; frameworkSdkFamily?: string },
  ) =>
    runOrchestrator({
      config: {
        programId: 'flow',
        wizardFlags: {},
        wizardFlagPayloads: {},
        switchboard: {},
        agentPrompts: () => Promise.resolve(FLOW),
        matchKeys: () => matchKeys,
        installSdkSkills: opts?.installSdkSkills ?? true,
        frameworkSdkFamily: opts?.frameworkSdkFamily ?? 'sdk-posthog-python',
      },
      input: { installDir: dir, flags: { ci: true } },
      boot: {
        skillsBaseUrl: 'https://skills.test',
        wizardFlags: {},
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

  it('installs the non-default v7 SDK skill and frames EXAMPLE.md as latest-major procedural guide', async () => {
    const result = await runWithKeys({
      framework: ['fastapi'],
      sdkPython: ['7'],
    });
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(menuFetchMock).toHaveBeenCalledTimes(1);
    expect(installs).toContain('sdk-posthog-python-v7');
    expect(installs).not.toContain('sdk-posthog-python-v8');
    expect(prompts.install).toContain('sdk-posthog-python-v7/SKILL.md');
    expect(prompts.install).toContain(
      'high-level procedures and file placement',
    );
    expect(prompts.install).toContain('posthog-python 7.x');
  });

  it('keeps non-default EXAMPLE.md framing even when downloading the non-default SDK skill fails', async () => {
    const saved = skills['sdk-posthog-python-v7'];
    delete skills['sdk-posthog-python-v7'];
    try {
      const result = await runWithKeys({
        framework: ['fastapi'],
        sdkPython: ['7'],
      });
      expect(result.outcome).toBe(RunOutcome.Success);
      expect(prompts.install).toContain(
        'high-level procedures and file placement',
      );
      expect(prompts.install).toContain('posthog-python 7.x');
      expect(prompts.install).not.toContain('sdk-posthog-python-v7/SKILL.md');
    } finally {
      skills['sdk-posthog-python-v7'] = saved;
    }
  });

  it('installs the default v8 SDK skill on greenfield Python without non-default caveats', async () => {
    const result = await runWithKeys({ framework: ['fastapi'] });
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(installs).toContain('sdk-posthog-python-v8');
    expect(prompts.install).toContain('sdk-posthog-python-v8/SKILL.md');
    expect(prompts.install).not.toContain(
      'high-level procedures and file placement',
    );
  });

  it('continues without an SDK skill when the installed SDK major has no published variant', async () => {
    const result = await runWithKeys({
      framework: ['fastapi'],
      sdkPython: ['3'],
    });
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(installs).toEqual(['integration-fastapi']);
    expect(prompts.install).not.toContain('sdk-posthog-python');
    expect(prompts.install).toContain(noSkillFact('posthog-python', '3'));
  });

  it.each(['5', '7'])(
    'gives a project on %s the one multi-tag entry and names that major',
    async (major) => {
      menuFetchMock.mockImplementationOnce(() => Promise.resolve(multiTagMenu));
      const result = await runWithKeys({
        framework: ['fastapi'],
        sdkPython: [major],
      });
      expect(result.outcome).toBe(RunOutcome.Success);
      expect(installs).toContain('sdk-posthog-python-legacy');
      expect(installs).not.toContain('sdk-posthog-python-v8');
      expect(prompts.install).toContain('sdk-posthog-python-legacy/SKILL.md');
      expect(prompts.install).toContain(`posthog-python ${major}.x`);
      expect(prompts.install).not.toContain(
        noSkillFact('posthog-python', major),
      );
    },
  );

  it('fans out multi-major sdkPython arrays to install all majors and frame non-default ones', async () => {
    const result = await runWithKeys({
      framework: ['fastapi'],
      sdkPython: ['7', '8'],
    });
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(installs).toContain('sdk-posthog-python-v7');
    expect(installs).toContain('sdk-posthog-python-v8');
    expect(prompts.install).toContain('sdk-posthog-python-v7/SKILL.md');
    expect(prompts.install).toContain('sdk-posthog-python-v8/SKILL.md');
    expect(prompts.install).toContain(
      'high-level procedures and file placement',
    );
    expect(prompts.install).toContain('posthog-python 7.x');
  });

  it('installs the majors that have a variant and notes the one that has none', async () => {
    const result = await runWithKeys({
      framework: ['fastapi'],
      sdkPython: ['6', '7'],
    });
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(installs).toContain('sdk-posthog-python-v7');
    expect(prompts.install).toContain(noSkillFact('posthog-python', '6'));
    expect(prompts.install).not.toContain(noSkillFact('posthog-python', '7'));
  });

  it('skips SDK skill planning and downloads when installSdkSkills is false', async () => {
    const result = await runWithKeys(
      { framework: ['fastapi'], sdkPython: ['3'] },
      { installSdkSkills: false, frameworkSdkFamily: 'sdk-posthog-python' },
    );
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(installs).toEqual(['integration-fastapi']);
    expect(prompts.install).not.toContain('sdk-posthog-python');
  });

  it('refuses to delete or write across a symlinked .posthog-wizard-cache directory', async () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-cache-'));
    try {
      const outsideSdk = path.join(outsideDir, 'sdk');
      fs.mkdirSync(outsideSdk, { recursive: true });
      fs.writeFileSync(path.join(outsideSdk, 'keep.txt'), 'safe');
      fs.symlinkSync(outsideDir, path.join(dir, '.posthog-wizard-cache'));

      const plan = planSdkSkillInstalls({
        menuEntries: Object.values(menu.categories).flat(),
        matchKeys: { framework: ['fastapi'], sdkPython: ['7'] },
        frameworkSdkFamily: 'sdk-posthog-python',
      });

      const cleanup = registerWizardCacheCleanup(dir, 'sdk');
      const installed = await installPlannedSdkSkills(plan, {
        installDir: dir,
      });
      cleanup();

      expect(installed).toEqual({
        kind: 'ok',
        sdkSkillPaths: [],
        nonDefaultSdks: [{ pkg: 'posthog-python', major: '7' }],
      });
      expect(installs).toEqual([]);
      expect(fs.existsSync(path.join(outsideSdk, 'keep.txt'))).toBe(true);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  const planV7 = () => {
    const plan = planSdkSkillInstalls({
      menuEntries: Object.values(menu.categories).flat(),
      matchKeys: { framework: ['fastapi'], sdkPython: ['7'] },
      frameworkSdkFamily: 'sdk-posthog-python',
    });
    return plan;
  };

  it('refuses a symlinked leaf skill folder under the sdk cache', async () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-leaf-'));
    try {
      const sdkRoot = path.join(dir, '.posthog-wizard-cache', 'sdk');
      fs.mkdirSync(sdkRoot, { recursive: true });
      fs.symlinkSync(outsideDir, path.join(sdkRoot, 'sdk-posthog-python-v7'));

      const installed = await installPlannedSdkSkills(planV7(), {
        installDir: dir,
      });

      expect(installed).toMatchObject({ kind: 'ok', sdkSkillPaths: [] });
      expect(installs).toEqual([]);
      expect(fs.readdirSync(outsideDir)).toEqual([]);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('installs SDK skills and cleans the cache when installDir is itself a symlink', async () => {
    const link = `${dir}-link`;
    fs.symlinkSync(dir, link);
    try {
      const cleanup = registerWizardCacheCleanup(link, 'sdk');
      const installed = await installPlannedSdkSkills(planV7(), {
        installDir: link,
      });
      expect(installed).toMatchObject({
        kind: 'ok',
        sdkSkillPaths: [
          '.posthog-wizard-cache/sdk/sdk-posthog-python-v7/SKILL.md',
        ],
      });
      expect(
        fs.existsSync(path.join(dir, '.posthog-wizard-cache', 'sdk')),
      ).toBe(true);
      cleanup();
      expect(fs.existsSync(path.join(dir, '.posthog-wizard-cache'))).toBe(
        false,
      );
    } finally {
      fs.rmSync(link, { force: true });
    }
  });

  describe('wizard cache confinement', () => {
    const cacheDir = () => path.join(dir, '.posthog-wizard-cache');
    const keep = (...parts: string[]) => {
      const file = path.join(dir, ...parts, 'keep.txt');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'safe');
      return file;
    };
    const install = (opts: { installDir?: string; skillsRoot?: string }) =>
      installPlannedSdkSkills(planV7(), { installDir: dir, ...opts });

    it('keeps a project folder that .posthog-wizard-cache links to', () => {
      const kept = keep('real-cache', 'sdk');
      fs.symlinkSync(path.join(dir, 'real-cache'), cacheDir());

      registerWizardCacheCleanup(dir, 'sdk')();
      expect(fs.existsSync(kept)).toBe(true);
      registerWizardCacheCleanup(dir)();

      expect(fs.existsSync(kept)).toBe(true);
      expect(fs.lstatSync(cacheDir()).isSymbolicLink()).toBe(true);
    });

    it('keeps a project folder that the sdk cache folder links to', () => {
      const kept = keep('elsewhere');
      fs.mkdirSync(cacheDir());
      fs.symlinkSync(path.join(dir, 'elsewhere'), path.join(cacheDir(), 'sdk'));

      registerWizardCacheCleanup(dir, 'sdk')();

      expect(fs.existsSync(kept)).toBe(true);
      expect(fs.lstatSync(path.join(cacheDir(), 'sdk')).isSymbolicLink()).toBe(
        true,
      );
    });

    it('keeps a file where the cache folder should be', () => {
      fs.writeFileSync(cacheDir(), 'not a folder');

      registerWizardCacheCleanup(dir)();

      expect(fs.readFileSync(cacheDir(), 'utf8')).toBe('not a folder');
    });

    it.each(['../victim', './sdk', 'sdk/../../victim'])(
      'keeps what a cleanup of %j would reach by leaving the cache',
      (subDir) => {
        const sdkKept = keep('.posthog-wizard-cache', 'sdk');
        const victim = keep('victim');

        registerWizardCacheCleanup(dir, subDir)();

        expect(fs.existsSync(victim)).toBe(true);
        expect(fs.existsSync(sdkKept)).toBe(true);
      },
    );

    it('removes the sdk cache and then the empty cache folder', () => {
      keep('.posthog-wizard-cache', 'sdk');

      registerWizardCacheCleanup(dir, 'sdk')();

      expect(fs.existsSync(cacheDir())).toBe(false);
    });

    it('keeps the cache folder when something else is in it', () => {
      keep('.posthog-wizard-cache', 'sdk');
      const other = keep('.posthog-wizard-cache', 'other');

      registerWizardCacheCleanup(dir, 'sdk')();

      expect(fs.existsSync(other)).toBe(true);
      expect(fs.existsSync(path.join(cacheDir(), 'sdk'))).toBe(false);
    });

    it.each([
      ['an absolute root', path.join(os.tmpdir(), 'abs-cache')],
      ['a root with a dot segment', './cache'],
      ['a root with a dot-dot segment', '../out'],
      ['a root with a nested dot-dot segment', 'a/../../out'],
    ])('refuses %s', async (_name, skillsRoot) => {
      const installed = await install({ skillsRoot });

      expect(installed).toMatchObject({ kind: 'ok', sdkSkillPaths: [] });
      expect(installs).toEqual([]);
    });

    it('refuses a skill with an empty id', async () => {
      const plan = planV7();
      plan.entries[0] = { ...plan.entries[0], id: '' };

      const installed = await installPlannedSdkSkills(plan, {
        installDir: dir,
      });

      expect(installed).toMatchObject({ kind: 'ok', sdkSkillPaths: [] });
      expect(installs).toEqual([]);
    });

    it('installs into a project folder that does not exist yet', async () => {
      const installDir = path.join(dir, 'missing');

      const installed = await install({ installDir });

      expect(installed).toMatchObject({
        kind: 'ok',
        sdkSkillPaths: [
          '.posthog-wizard-cache/sdk/sdk-posthog-python-v7/SKILL.md',
        ],
      });
      expect(fs.existsSync(path.join(installDir, SDK_SKILLS_ROOT))).toBe(true);
    });

    it('refuses a project path that is a file', async () => {
      const installDir = path.join(dir, 'file');
      fs.writeFileSync(installDir, 'not a folder');

      const installed = await install({ installDir });

      expect(installed).toMatchObject({ kind: 'ok', sdkSkillPaths: [] });
      expect(installs).toEqual([]);
    });

    it('refuses a project path beneath a file', async () => {
      fs.writeFileSync(path.join(dir, 'file'), 'not a folder');

      const installed = await install({
        installDir: path.join(dir, 'file', 'project'),
      });

      expect(installed).toMatchObject({ kind: 'ok', sdkSkillPaths: [] });
      expect(installs).toEqual([]);
    });

    it.skipIf(process.getuid?.() === 0)(
      'refuses a cache folder it cannot look into',
      async () => {
        fs.mkdirSync(cacheDir());
        fs.chmodSync(cacheDir(), 0o000);
        try {
          const installed = await install({});

          expect(installed).toMatchObject({ kind: 'ok', sdkSkillPaths: [] });
          expect(installs).toEqual([]);
        } finally {
          fs.chmodSync(cacheDir(), 0o755);
        }
      },
    );

    it('reports an aborted run, and a finished one when not aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      expect(await install({}).then((r) => r.kind)).toBe('ok');
      expect(
        await installPlannedSdkSkills(planV7(), {
          installDir: dir,
          signal: controller.signal,
        }),
      ).toEqual({ kind: 'aborted' });
    });

    it('installs nothing for an empty plan', async () => {
      expect(
        await installPlannedSdkSkills(
          { entries: [], nonDefaultSdks: [], noSkillFacts: [] },
          { installDir: dir, skillsRoot: '../out' },
        ),
      ).toEqual({ kind: 'ok', sdkSkillPaths: [], nonDefaultSdks: [] });
    });
  });
});
