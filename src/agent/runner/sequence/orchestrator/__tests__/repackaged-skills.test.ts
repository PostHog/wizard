/** A task reads a skill written once for every framework after the run completes it from the framework's pack. */
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
vi.mock('@shared/skill-menu', () => ({
  fetchSkillMenu: () => Promise.resolve(menu),
}));
vi.mock('@shared/skill-install', async (importActual) => ({
  ...(await importActual<typeof import('@shared/skill-install')>()),
  // Writes the files a skill ships, where the real install would unpack them.
  installSkillById: (
    id: string,
    installDir: string,
    _url: string,
    options: { skillsRoot: string },
  ) => {
    installs.push(id);
    const files = skills[id];
    if (!files)
      return Promise.resolve({ kind: 'skill-not-found', skillId: id });
    const relative = `${options.skillsRoot}/${id}`;
    for (const [file, contents] of Object.entries(files)) {
      const target = path.join(installDir, relative, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents);
    }
    return Promise.resolve({ kind: 'ok', path: relative });
  },
}));
vi.mock('../../../../yara-hooks', async (importActual) => ({
  ...(await importActual<typeof import('../../../../yara-hooks')>()),
  // The scan of a completed skill's SKILL.md; the install's own scan is inside the mocked installer.
  scanInstalledSkillFile: (file: string) => {
    scanned.push(file);
    return scan();
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
import { ErrorCodes } from '@shared/errors';
import { analytics } from '@utils/analytics';
import { RunOutcome } from '../../../shared/types';
import { runOrchestrator } from '../orchestrator-runner';
import type { SequenceContext } from '../../../shared/types';
import type { QueueStore } from '../queue';

const FLOW: Record<string, string> = {
  install:
    '---\nskills: [integration-install, kept-skill]\ndependsOn: []\n---\ninstall',
  report:
    '---\nsink: true\nskills: [kept-skill]\ndependsOn: [install]\n---\nreport',
};

const entry = (id: string, rest: object = {}) => ({
  id,
  name: id,
  family: id,
  downloadUrl: `https://skills.test/${id}.zip`,
  ...rest,
});
const MENU = {
  categories: {
    skills: [
      entry('integration-nextjs', {
        family: 'integration',
        tags: ['framework:nextjs', 'default'],
      }),
      entry('kept-skill'),
      entry('integration-install', { frameworkReferences: 'integration' }),
    ],
  },
};

const PACK = {
  'SKILL.md': 'the pack',
  'variant.json': JSON.stringify({
    id: 'nextjs',
    displayName: 'Next.js',
    rules: { file: 'references/COMMANDMENTS.md', description: 'Rules' },
    products: {
      integration: [{ file: 'references/next-js.md', description: 'Next.js' }],
    },
  }),
  'references/next-js.md': 'the library page',
  'references/COMMANDMENTS.md': 'the rules',
};
const SKILLS: Record<string, Record<string, string>> = {
  'integration-nextjs': PACK,
  'kept-skill': { 'SKILL.md': 'kept, as published' },
  'integration-install': {
    'SKILL.md':
      '# Install for {framework_name}\n\n{framework_docs}\n{framework_rules}\n',
  },
};

/** A record without one of its keys. */
const without = <T>(
  record: Record<string, T>,
  key: string,
): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));

type Inputs = {
  prompt: string;
  emit: (event: { kind: 'handoff'; text: string }) => void;
  analyticsProperties: { task_type: string; task_id?: string };
  orchestrator: { store: QueueStore };
};

let skills = SKILLS;
const menu = MENU;
let installs: string[] = [];
let scanned: string[] = [];
let scan: () => Promise<string | null> = () => Promise.resolve(null);
let prompts: Record<string, string> = {};
let dir = '';
// What the install task finds on disk; the run removes its cache folder when it ends.
let completed: Record<string, string> = {};

const read = (id: string, file: string): string | undefined => {
  const target = path.join(dir, '.posthog-wizard-cache', 'skills', id, file);
  return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
};

/** The fake harness: a planner queues install then report, and every task completes. */
function harnessRun(raw: unknown) {
  const inputs = raw as Inputs;
  const { store } = inputs.orchestrator;
  const type = inputs.analyticsProperties.task_type;
  prompts[type] = inputs.prompt;
  if (type === 'install') {
    completed = {
      skill: read('integration-install', 'SKILL.md') ?? '',
      page: read('integration-install', 'references/next-js.md') ?? '',
    };
  }
  if (type === 'seed') {
    const install = store.enqueue({ type: 'install' });
    store.enqueue({ type: 'report', dependsOn: [install.id] });
  } else {
    if (type === 'report') inputs.emit({ kind: 'handoff', text: '# Report' });
    store.complete(inputs.analyticsProperties.task_id as string);
  }
  return Promise.resolve({ kind: 'success' as const });
}

describe('step skills completed from the pack', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repackaged-skills-'));
    skills = SKILLS;
    installs = [];
    scanned = [];
    scan = () => Promise.resolve(null);
    prompts = {};
    completed = {};
    vi.mocked(analytics.wizardCapture).mockClear();
    vi.mocked(analytics.setTag).mockClear();
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = () =>
    runOrchestrator({
      config: {
        programId: 'flow',
        wizardFlags: {},
        wizardFlagPayloads: {},
        switchboard: {},
        agentPrompts: () => Promise.resolve(FLOW),
        matchKeys: () => ({ framework: ['nextjs'] }),
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

  const unavailable = () =>
    vi
      .mocked(analytics.wizardCapture)
      .mock.calls.filter(
        ([event]) => event === 'orchestrator repackaged skill unavailable',
      )
      .map(([, properties]) => properties);

  it('installs each skill a prompt names, and completes the one written for every framework', async () => {
    const result = await run();

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(installs).toEqual([
      'integration-nextjs',
      'integration-install',
      'kept-skill',
      'kept-skill',
    ]);
    expect(completed).toEqual({
      skill:
        '# Install for Next.js\n\n- `references/next-js.md` - Next.js\n- `references/COMMANDMENTS.md` - Rules\n',
      page: 'the library page',
    });
    expect(prompts.install).toContain('skills/integration-install/SKILL.md');
    expect(prompts.install).toContain('skills/kept-skill/SKILL.md');
    expect(unavailable()).toEqual([]);
    // The one file scanned is the rewritten SKILL.md, in the temp folder the skill is built in.
    expect(scanned.map((file) => file.split(path.sep).slice(-2))).toEqual([
      ['integration-install', 'SKILL.md'],
    ]);
  });

  it('starts the skill from an empty folder, so a page an earlier run left does not replace the pack page', async () => {
    const left = path.join(
      dir,
      '.posthog-wizard-cache/skills/integration-install/references',
    );
    fs.mkdirSync(left, { recursive: true });
    fs.writeFileSync(path.join(left, 'next-js.md'), 'an earlier release');

    const result = await run();

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(completed.page).toBe('the library page');
    expect(unavailable()).toEqual([]);
  });

  it('fails the run before any task starts when the pack did not install', async () => {
    skills = without(SKILLS, 'integration-nextjs');
    const result = await run();

    expect(result.outcome).toBe(RunOutcome.Failed);
    expect(result.failure?.code).toBe(
      ErrorCodes.AgentOrchestratorSkillVariantMissing,
    );
    expect(installs).not.toContain('integration-install');
    expect(prompts).toEqual({});
  });

  it.each([
    [
      'the pack cannot complete it',
      () => {
        skills = {
          ...SKILLS,
          'integration-nextjs': without(PACK, 'variant.json'),
        };
      },
      'the pack has no variant.json',
    ],
    [
      'it fails to install',
      () => {
        skills = without(SKILLS, 'integration-install');
      },
      'skill-not-found',
    ],
    [
      'the scan rejects the completed skill',
      () => {
        scan = () => Promise.resolve('prompt injection in SKILL.md');
      },
      'prompt injection in SKILL.md',
    ],
    [
      'the scan of the completed skill fails',
      () => {
        scan = () => Promise.reject(new Error('engine unavailable'));
      },
      'scan failed: engine unavailable',
    ],
  ])(
    'fails the task, which never reads the skill, when %s',
    async (_, arrange, reason) => {
      arrange();
      const result = await run();

      expect(result.outcome).toBe(RunOutcome.Failed);
      expect(prompts.install).toBeUndefined();
      expect(read('integration-install', 'SKILL.md')).toBeUndefined();
      // The skill is reported once, however many attempts wait on it.
      expect(unavailable()).toEqual([
        { skill: 'integration-install', reason, framework: 'nextjs' },
      ]);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'fails the task, and writes nothing through it, when the skills folder is a link',
    async () => {
      fs.mkdirSync(path.join(dir, 'outside'));
      fs.mkdirSync(path.join(dir, '.posthog-wizard-cache'));
      fs.symlinkSync(
        path.join(dir, 'outside'),
        path.join(dir, '.posthog-wizard-cache/skills'),
      );

      const result = await run();

      expect(result.outcome).toBe(RunOutcome.Failed);
      expect(prompts.install).toBeUndefined();
      expect(installs).not.toContain('integration-install');
      expect(unavailable()).toEqual([
        {
          skill: 'integration-install',
          reason:
            'a skill path passes through a link: .posthog-wizard-cache/skills',
          framework: 'nextjs',
        },
      ]);
    },
  );
});
