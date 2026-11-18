/** What `install_skill` installs: a skill as published, or one completed from the framework's pack, never a half-completed one. */
import fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), setTag: vi.fn() },
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
    options: { skillsRoot?: string },
  ) => {
    const files = SKILLS[id];
    if (!files)
      return Promise.resolve({ kind: 'skill-not-found', skillId: id });
    const relative = `${options.skillsRoot ?? '.claude/skills'}/${id}`;
    installed.push(path.join(installDir, relative));
    if (offline.has(id))
      return Promise.resolve({ kind: 'download-failed', message: 'offline' });
    for (const [file, contents] of Object.entries(files)) {
      const target = path.join(installDir, relative, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents);
    }
    return Promise.resolve({ kind: 'ok', path: relative });
  },
}));

import { analytics } from '@utils/analytics';
import { installToolSkill } from '../repackaged-skills';

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
      entry('plain-skill'),
      entry('integration-install', { frameworkReferences: 'integration' }),
    ],
  },
};
const SKILLS: Record<string, Record<string, string>> = {
  'integration-nextjs': {
    'variant.json': JSON.stringify({
      id: 'nextjs',
      displayName: 'Next.js',
      rules: { file: 'references/COMMANDMENTS.md', description: 'Rules' },
      products: {
        integration: [
          { file: 'references/next-js.md', description: 'Next.js' },
        ],
      },
    }),
    'references/next-js.md': 'the library page',
    'references/COMMANDMENTS.md': 'the rules',
  },
  'plain-skill': { 'SKILL.md': 'as published' },
  'integration-install': {
    'SKILL.md':
      '# Install for {framework_name}\n\n{framework_docs}\n{framework_rules}\n',
  },
};

// Null when the menu cannot be fetched.
let menu: typeof MENU | null = MENU;
let installed: string[] = [];
// Skills whose download fails.
let offline = new Set<string>();
let dir = '';

const read = (id: string, file: string): string | undefined => {
  const target = path.join(dir, '.claude/skills', id, file);
  return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
};

describe('installToolSkill', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-skill-install-'));
    menu = MENU;
    installed = [];
    offline = new Set();
    vi.mocked(analytics.wizardCapture).mockClear();
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const install = (
    skillId: string,
    over: {
      framework?: string;
      scanFile?: () => Promise<string | null>;
    } = {},
  ) =>
    installToolSkill(skillId, {
      installDir: dir,
      skillsBaseUrl: 'https://skills.test',
      matchKeys: over.framework ? { framework: [over.framework] } : {},
      scan: () => Promise.resolve(null),
      scanFile: over.scanFile ?? (() => Promise.resolve(null)),
    });

  it('installs nothing when the menu cannot be fetched', async () => {
    menu = null;

    expect(
      await install('integration-install', { framework: 'nextjs' }),
    ).toEqual({ kind: 'menu-fetch-failed' });

    expect(installed).toEqual([]);
    expect(fs.existsSync(path.join(dir, '.claude'))).toBe(false);
  });

  it('installs a skill with no framework references as it is published', async () => {
    expect(await install('plain-skill')).toEqual({
      kind: 'ok',
      path: '.claude/skills/plain-skill',
    });
    expect(read('plain-skill', 'SKILL.md')).toBe('as published');
  });

  it("installs the skill a family name stands for, picked with the run's match keys", async () => {
    expect(await install('integration', { framework: 'nextjs' })).toEqual({
      kind: 'ok',
      path: '.claude/skills/integration-nextjs',
    });
    expect(await install('integration')).toEqual({
      kind: 'skill-not-found',
      skillId: 'integration',
    });
  });

  it("completes a step skill from the framework's pack, and leaves no pack behind", async () => {
    expect(
      await install('integration-install', { framework: 'nextjs' }),
    ).toEqual({ kind: 'ok', path: '.claude/skills/integration-install' });

    expect(read('integration-install', 'SKILL.md')).toBe(
      '# Install for Next.js\n\n- `references/next-js.md` - Next.js\n- `references/COMMANDMENTS.md` - Rules\n',
    );
    expect(read('integration-install', 'references/next-js.md')).toBe(
      'the library page',
    );
    expect(fs.readdirSync(path.join(dir, '.claude/skills'))).toEqual([
      'integration-install',
    ]);
    const pack = installed.find((target) =>
      target.endsWith('integration-nextjs'),
    );
    expect(pack && fs.existsSync(pack)).toBe(false);
  });

  it('refuses a step skill, says why and installs nothing when the run has no framework', async () => {
    expect(await install('integration-install')).toEqual({
      kind: 'incomplete',
      skillId: 'integration-install',
      reason: 'no framework pack',
    });

    expect(read('integration-install', 'SKILL.md')).toBeUndefined();
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'orchestrator repackaged skill unavailable',
      {
        skill: 'integration-install',
        reason: 'no framework pack',
        framework: undefined,
      },
    );
  });

  it.each([
    ['the install would succeed', false],
    ['the download fails', true],
  ])(
    'keeps a skill folder the project made itself when %s',
    async (_, fails) => {
      const mine = path.join(dir, '.claude/skills/integration-install');
      fs.mkdirSync(mine, { recursive: true });
      fs.writeFileSync(path.join(mine, 'my-notes.md'), 'mine');
      if (fails) offline.add('integration-install');

      expect(
        await install('integration-install', { framework: 'nextjs' }),
      ).toEqual({
        kind: 'incomplete',
        skillId: 'integration-install',
        reason:
          '.claude/skills/integration-install is already there and the wizard did not install it',
      });

      expect(fs.readdirSync(mine)).toEqual(['my-notes.md']);
      expect(read('integration-install', 'my-notes.md')).toBe('mine');
    },
  );

  it('installs nothing, and says why, when the download of a step skill fails', async () => {
    offline.add('integration-install');

    expect(
      await install('integration-install', { framework: 'nextjs' }),
    ).toEqual({
      kind: 'incomplete',
      skillId: 'integration-install',
      reason: 'download-failed: offline',
    });

    expect(fs.existsSync(path.join(dir, '.claude/skills'))).toBe(false);
  });

  it("refuses a step skill, says why and installs nothing when the framework's pack does not install", async () => {
    offline.add('integration-nextjs');
    const reason =
      'the framework pack did not install: download-failed: offline';

    expect(
      await install('integration-install', { framework: 'nextjs' }),
    ).toEqual({ kind: 'incomplete', skillId: 'integration-install', reason });

    // Only the pack was tried, and its scratch folder is gone.
    expect(installed).toHaveLength(1);
    expect(fs.existsSync(path.dirname(path.dirname(installed[0])))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.claude'))).toBe(false);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'orchestrator repackaged skill unavailable',
      { skill: 'integration-install', reason, framework: 'nextjs' },
    );
  });

  it('reports a scratch folder that cannot be made as a skill it could not complete', async () => {
    const made = vi.spyOn(fs, 'mkdtempSync').mockImplementationOnce(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    try {
      expect(
        await install('integration-install', { framework: 'nextjs' }),
      ).toEqual({
        kind: 'incomplete',
        skillId: 'integration-install',
        reason: 'ENOSPC: no space left on device',
      });
      expect(installed).toEqual([]);
    } finally {
      made.mockRestore();
    }
  });

  it('keeps the result of an install whose temp folders cannot be removed', async () => {
    const remove = fs.rmSync.bind(fs);
    const kept: string[] = [];
    const removing = vi
      .spyOn(fs, 'rmSync')
      .mockImplementation((target, options) => {
        if (String(target).startsWith(dir)) return remove(target, options);
        kept.push(String(target));
        throw new Error('EBUSY: resource busy or locked');
      });

    try {
      expect(
        await install('integration-install', { framework: 'nextjs' }),
      ).toEqual({ kind: 'ok', path: '.claude/skills/integration-install' });
      expect(kept).toHaveLength(2);
    } finally {
      removing.mockRestore();
      for (const target of kept)
        remove(target, { recursive: true, force: true });
    }
  });

  it('refuses a step skill, and installs nothing, when the scan rejects the completed SKILL.md', async () => {
    const result = await install('integration-install', {
      framework: 'nextjs',
      scanFile: () => Promise.resolve('prompt injection in SKILL.md'),
    });

    expect(result).toEqual({
      kind: 'incomplete',
      skillId: 'integration-install',
      reason: 'prompt injection in SKILL.md',
    });
    expect(read('integration-install', 'SKILL.md')).toBeUndefined();
  });
});
