/** Each way the installer of a step skill ends: installed, completed and scanned, or refused with its reason. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WIZARD_MARKER, type InstallSkillResult } from '@shared/skill-install';
import type { SkillEntry } from '@shared/skill-menu';
import {
  repackagedSkillInstaller,
  type RepackagedSkillRun,
} from '../repackaged-skills';

const SKILLS_ROOT = '.posthog-wizard-cache/skills';
const REFERENCE = '.posthog-wizard-cache/reference/integration-nextjs';
// A pack folder with pages and no `variant.json`.
const NO_VARIANT = '.posthog-wizard-cache/reference/no-variant';

const PACK: Record<string, string> = {
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
const STEP =
  '# Install for {framework_name}\n\n{framework_docs}\n{framework_rules}\n';
const COMPLETED =
  '# Install for Next.js\n\n- `references/next-js.md` - Next.js\n- `references/COMMANDMENTS.md` - Rules\n';

const entry = (id: string, rest: Partial<SkillEntry>): SkillEntry => ({
  id,
  name: id,
  family: id,
  downloadUrl: `https://skills.test/${id}.zip`,
  ...rest,
});
const INSTALL = {
  ...entry('integration-install', {}),
  frameworkReferences: 'integration',
};

describe('repackagedSkillInstaller', () => {
  let dir = '';
  let installed: string[] = [];
  let stages: string[] = [];
  let scanned: string[] = [];
  let unavailable: { skill: string; reason: string }[] = [];

  const write = (root: string, files: Record<string, string>) => {
    for (const [file, contents] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), contents);
    }
  };
  const folder = (id: string, root = SKILLS_ROOT) => path.join(dir, root, id);
  const read = (
    id: string,
    file: string,
    root = SKILLS_ROOT,
  ): string | undefined =>
    fs.existsSync(path.join(folder(id, root), file))
      ? fs.readFileSync(path.join(folder(id, root), file), 'utf8')
      : undefined;
  const leftStages = () => stages.filter((stage) => fs.existsSync(stage));

  /** Unpacks a skill where the installer asks, as the real install does. */
  const install = (id: string, stage: string): Promise<InstallSkillResult> => {
    installed.push(id);
    stages.push(stage);
    write(path.join(stage, 'skill', id), { 'SKILL.md': STEP });
    return Promise.resolve({ kind: 'ok', path: `skill/${id}` });
  };

  const run = (overrides: Partial<RepackagedSkillRun> = {}) =>
    repackagedSkillInstaller({
      installDir: dir,
      skillsRoot: SKILLS_ROOT,
      ownsSkillsRoot: true,
      referencePath: REFERENCE,
      install,
      scanFile: (file) => {
        scanned.push(fs.readFileSync(file, 'utf8'));
        return Promise.resolve(null);
      },
      onUnavailable: (skill, reason) =>
        unavailable.push({ skill: skill.id, reason }),
      ...overrides,
    });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repackaged-installer-'));
    installed = [];
    stages = [];
    scanned = [];
    unavailable = [];
    write(path.join(dir, REFERENCE), PACK);
    write(path.join(dir, NO_VARIANT), { 'references/next-js.md': 'a page' });
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('builds the skill in a temp folder, scans the SKILL.md it rewrote, then puts it in place', async () => {
    expect(await run()(INSTALL)).toBe(`${SKILLS_ROOT}/${INSTALL.id}`);

    expect(read(INSTALL.id, 'SKILL.md')).toBe(COMPLETED);
    expect(read(INSTALL.id, 'references/next-js.md')).toBe('the library page');
    expect(read(INSTALL.id, WIZARD_MARKER)).toBe('');
    expect(scanned).toEqual([COMPLETED]);
    expect(leftStages()).toEqual([]);
    expect(unavailable).toEqual([]);
  });

  it('installs a skill once, however many tasks name it', async () => {
    const installer = run();

    await Promise.all([installer(INSTALL), installer(INSTALL)]);

    expect(installed).toEqual([INSTALL.id]);
  });

  it('replaces a folder in its own root whole, so no page an earlier run left survives', async () => {
    write(folder(INSTALL.id), {
      'references/next-js.md': 'an earlier release',
      'references/gone.md': 'a page the pack no longer has',
    });

    await run()(INSTALL);

    expect(read(INSTALL.id, 'references/next-js.md')).toBe('the library page');
    expect(read(INSTALL.id, 'references/gone.md')).toBeUndefined();
  });

  it('refuses the skill when the run has no framework pack, and installs nothing', async () => {
    await expect(run({ referencePath: undefined })(INSTALL)).rejects.toThrow(
      'no framework pack',
    );

    expect(installed).toEqual([]);
    expect(unavailable).toEqual([
      { skill: INSTALL.id, reason: 'no framework pack' },
    ]);
  });

  // The id comes from the menu, and it names the folder the installer replaces.
  it.each(['../../src', '..', 'a/b'])(
    'removes and installs nothing for the menu id %j',
    async (id) => {
      write(path.join(dir, 'src'), { 'app.ts': 'the app' });

      await expect(run()({ ...INSTALL, id })).rejects.toThrow(
        `unusable skill id: ${id}`,
      );

      expect(fs.readFileSync(path.join(dir, 'src/app.ts'), 'utf8')).toBe(
        'the app',
      );
      expect(fs.existsSync(path.join(dir, REFERENCE, 'variant.json'))).toBe(
        true,
      );
      expect(installed).toEqual([]);
      expect(unavailable).toEqual([
        { skill: id, reason: `unusable skill id: ${id}` },
      ]);
    },
  );

  it.each([
    [
      'the install finds no such skill',
      {
        install: (id: string): Promise<InstallSkillResult> =>
          Promise.resolve({ kind: 'skill-not-found', skillId: id }),
      },
      'skill-not-found',
    ],
    [
      'the install throws',
      {
        install: (): Promise<InstallSkillResult> =>
          Promise.reject(new Error('disk full')),
      },
      'disk full',
    ],
  ])('refuses the skill when %s', async (_, overrides, reason) => {
    const installer = run(overrides);

    await expect(installer(INSTALL)).rejects.toThrow(reason);
    await expect(installer(INSTALL)).rejects.toThrow(reason);

    // A skill is reported once, however many tasks wait on it.
    expect(unavailable).toEqual([{ skill: INSTALL.id, reason }]);
  });

  it.each([
    [
      'the download fails after it wrote files',
      {
        install: (id: string, stage: string): Promise<InstallSkillResult> => {
          stages.push(stage);
          write(path.join(stage, 'skill', id), { 'SKILL.md': STEP });
          return Promise.resolve({
            kind: 'download-failed',
            message: 'zip entry escapes destination',
          });
        },
      },
      'download-failed: zip entry escapes destination',
    ],
    [
      'the pack cannot complete it',
      { referencePath: NO_VARIANT },
      'the pack has no variant.json',
    ],
    [
      'the scan rejects the completed skill',
      { scanFile: () => Promise.resolve('prompt injection in SKILL.md') },
      'prompt injection in SKILL.md',
    ],
    [
      'the scan fails',
      { scanFile: () => Promise.reject(new Error('engine unavailable')) },
      'scan failed: engine unavailable',
    ],
  ])(
    'leaves no skill folder and no temp folder when %s',
    async (_, overrides, reason) => {
      await expect(run(overrides)(INSTALL)).rejects.toThrow(reason);

      expect(fs.existsSync(folder(INSTALL.id))).toBe(false);
      expect(stages).toHaveLength(1);
      expect(leftStages()).toEqual([]);
      expect(unavailable).toEqual([{ skill: INSTALL.id, reason }]);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'refuses the skill, and writes nothing through it, when the skills folder is a link',
    async () => {
      fs.mkdirSync(path.join(dir, 'outside', INSTALL.id), { recursive: true });
      fs.symlinkSync(path.join(dir, 'outside'), path.join(dir, SKILLS_ROOT));

      const reason = `a skill path passes through a link: ${SKILLS_ROOT}`;
      await expect(run()(INSTALL)).rejects.toThrow(reason);

      expect(fs.readdirSync(path.join(dir, 'outside'))).toEqual([INSTALL.id]);
      expect(installed).toEqual([]);
      expect(unavailable).toEqual([{ skill: INSTALL.id, reason }]);
    },
  );

  // `.claude/skills` is the project's: what the wizard did not put there is not its to replace.
  describe('in a skills root the project owns', () => {
    const ROOT = '.claude/skills';
    const NOT_OURS = `${ROOT}/${INSTALL.id} is already there and the wizard did not install it`;
    const project = (overrides: Partial<RepackagedSkillRun> = {}) =>
      run({ skillsRoot: ROOT, ownsSkillsRoot: false, ...overrides });

    it('installs into a folder that is not there yet, and marks it', async () => {
      expect(await project()(INSTALL)).toBe(`${ROOT}/${INSTALL.id}`);

      expect(read(INSTALL.id, 'SKILL.md', ROOT)).toBe(COMPLETED);
      expect(read(INSTALL.id, WIZARD_MARKER, ROOT)).toBe('');
    });

    it('replaces a folder the wizard installed', async () => {
      write(folder(INSTALL.id, ROOT), {
        [WIZARD_MARKER]: '',
        'references/gone.md': 'a page the pack no longer has',
      });

      await project()(INSTALL);

      expect(read(INSTALL.id, 'SKILL.md', ROOT)).toBe(COMPLETED);
      expect(read(INSTALL.id, 'references/gone.md', ROOT)).toBeUndefined();
    });

    it.each([
      ['would succeed', {}],
      [
        'would fail',
        {
          install: (): Promise<InstallSkillResult> =>
            Promise.resolve({ kind: 'download-failed', message: 'offline' }),
        },
      ],
    ])(
      'keeps a folder the wizard did not install, and fetches nothing, when the install %s',
      async (_, overrides) => {
        write(folder(INSTALL.id, ROOT), { 'my-notes.md': 'mine' });

        await expect(project(overrides)(INSTALL)).rejects.toThrow(NOT_OURS);

        expect(fs.readdirSync(folder(INSTALL.id, ROOT))).toEqual([
          'my-notes.md',
        ]);
        expect(read(INSTALL.id, 'my-notes.md', ROOT)).toBe('mine');
        expect(installed).toEqual([]);
        expect(unavailable).toEqual([{ skill: INSTALL.id, reason: NOT_OURS }]);
      },
    );

    it('keeps a folder that appears while the skill installs', async () => {
      const appears = (id: string, stage: string) => {
        write(folder(id, ROOT), { 'my-notes.md': 'mine' });
        return install(id, stage);
      };

      await expect(project({ install: appears })(INSTALL)).rejects.toThrow(
        NOT_OURS,
      );

      expect(fs.readdirSync(folder(INSTALL.id, ROOT))).toEqual(['my-notes.md']);
      expect(leftStages()).toEqual([]);
    });

    it.skipIf(process.platform === 'win32')(
      'refuses a link standing where the skill goes, even to a folder the wizard marked',
      async () => {
        write(path.join(dir, 'elsewhere'), {
          [WIZARD_MARKER]: '',
          'kept.md': 'kept',
        });
        fs.mkdirSync(path.join(dir, ROOT), { recursive: true });
        fs.symlinkSync(path.join(dir, 'elsewhere'), folder(INSTALL.id, ROOT));

        await expect(project()(INSTALL)).rejects.toThrow(NOT_OURS);

        expect(
          fs.readFileSync(path.join(dir, 'elsewhere/kept.md'), 'utf8'),
        ).toBe('kept');
        expect(fs.lstatSync(folder(INSTALL.id, ROOT)).isSymbolicLink()).toBe(
          true,
        );
        expect(installed).toEqual([]);
      },
    );
  });
});
