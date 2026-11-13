/** With `wizard-agent-dag-skills` on, a task reads the skill that stands in for the one its prompt names, completed from the framework's pack. */
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
vi.mock('../../../switchboard', async () => {
  const { VALID_MODELS } = await import('../../../switchboard/models');
  return {
    resolveHarness: () => ({ harness: 'pi', model: [...VALID_MODELS][0] }),
    resolveStageOverrides: () => ({}),
    areSeededTasksEnabled: () => false,
    isAgentDagEnabled: () => agentDag,
    isAgentDagSkillsEnabled: () => skillsFlag,
    getHarness: () => ({ runTask: (inputs: unknown) => harnessRun(inputs) }),
  };
});
vi.mock('../../../../agent-prompt-loader', async (importActual) => {
  const actual = await importActual<
    typeof import('../../../../agent-prompt-loader')
  >();
  return {
    ...actual,
    // The fetched flow: the same prompts, with the planner a fetched flow needs.
    loadAgentRegistry: (_url: string, flow: string, opts?: object) =>
      Promise.resolve(
        actual.bundledRegistry({ ...FLOW, plan: PLANNER }, flow, opts),
      ),
  };
});

import { analytics } from '@utils/analytics';
import { RunOutcome } from '../../../shared/types';
import { runOrchestrator } from '../orchestrator-runner';
import type { SequenceContext } from '../../../shared/types';
import type { QueueStore } from '../queue';

const PLANNER = '---\nseed: true\n---\nplan';
const FLOW: Record<string, string> = {
  install:
    '---\nskills: [flow-install, kept-skill]\ndependsOn: []\n---\ninstall',
  report:
    '---\nsink: true\nskills: [kept-skill]\ndependsOn: [install]\n---\nreport',
};

const entry = (id: string, rest: object = {}) => ({
  id,
  name: id,
  group: id,
  downloadUrl: `https://skills.test/${id}.zip`,
  ...rest,
});
const MENU = {
  categories: {
    skills: [
      entry('integration-nextjs', {
        group: 'integration',
        framework: 'nextjs',
        default: true,
      }),
      entry('flow-install-nextjs', {
        group: 'flow-install',
        framework: 'nextjs',
      }),
      entry('kept-skill'),
      entry('integration-install', {
        replaces: 'flow-install',
        frameworkReferences: 'integration',
      }),
      entry('integration-kept', { replaces: 'kept-skill' }),
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
  'flow-install-nextjs': { 'SKILL.md': 'install, as bundled today' },
  'kept-skill': { 'SKILL.md': 'kept, as published today' },
  'integration-install': {
    'SKILL.md':
      '# Install for {framework_name}\n\n{framework_docs}\n{framework_rules}\n',
  },
  'integration-kept': { 'SKILL.md': 'kept, republished' },
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

let agentDag = true;
let skillsFlag = true;
let skills = SKILLS;
let menu = MENU;
let installs: string[] = [];
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

describe('repackaged skills', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repackaged-skills-'));
    agentDag = true;
    skillsFlag = true;
    skills = SKILLS;
    menu = MENU;
    installs = [];
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
      },
      input: { installDir: dir, flags: { ci: true }, integration: 'nextjs' },
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

  it('installs the skill that stands in for each name, completed from the pack', async () => {
    const result = await run();

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(installs).toEqual([
      'integration-nextjs',
      'integration-install',
      'integration-kept',
    ]);
    expect(completed).toEqual({
      skill:
        '# Install for Next.js\n\n- `references/next-js.md` - Next.js\n- `references/COMMANDMENTS.md` - Rules\n',
      page: 'the library page',
    });
    expect(prompts.install).toContain('skills/integration-install/SKILL.md');
    expect(prompts.install).toContain('skills/integration-kept/SKILL.md');
    expect(prompts.install).not.toContain('flow-install-nextjs');
    expect(unavailable()).toEqual([]);
    expect(analytics.setTag).toHaveBeenCalledWith(
      'orchestrator_skills',
      'repackaged',
    );
  });

  it('installs the skills the prompts name while the flag is off', async () => {
    skillsFlag = false;
    const result = await run();

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(installs).toEqual([
      'integration-nextjs',
      'flow-install-nextjs',
      'kept-skill',
      'kept-skill',
    ]);
    expect(prompts.install).toContain('skills/flow-install-nextjs/SKILL.md');
    expect(analytics.setTag).toHaveBeenCalledWith(
      'orchestrator_skills',
      'bundles',
    );
  });

  it('reports bundles when the menu has no replacement, whatever the flag says', async () => {
    menu = {
      categories: {
        skills: MENU.categories.skills.filter(
          (skill) => !('replaces' in skill),
        ),
      },
    };
    const result = await run();

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(prompts.install).toContain('skills/flow-install-nextjs/SKILL.md');
    expect(analytics.setTag).toHaveBeenCalledWith(
      'orchestrator_skills',
      'bundles',
    );
    expect(unavailable()).toEqual([]);
  });

  it('reads them with fetched prompts too, since the two flags are independent', async () => {
    agentDag = false;
    const result = await run();

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(prompts.install).toContain('skills/integration-install/SKILL.md');
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
  ])(
    'falls back to the skill the prompt names when %s',
    async (_, arrange, reason) => {
      arrange();
      const result = await run();

      expect(result.outcome).toBe(RunOutcome.Success);
      expect(installs).toContain('flow-install-nextjs');
      expect(prompts.install).toContain('skills/flow-install-nextjs/SKILL.md');
      expect(prompts.install).toContain('skills/integration-kept/SKILL.md');
      expect(unavailable()).toEqual([
        {
          skill: 'integration-install',
          replaces: 'flow-install',
          reason,
          framework: 'nextjs',
        },
      ]);
    },
  );
});
