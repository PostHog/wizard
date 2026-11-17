/** Each way the installer of a step skill ends: installed, completed and scanned, or refused with its reason. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { InstallSkillResult } from '@shared/skill-install';
import type { SkillEntry } from '@shared/skill-menu';
import {
  repackagedSkillInstaller,
  type RepackagedSkillRun,
} from '../repackaged-skills';

const SKILLS_ROOT = '.posthog-wizard-cache/skills';
const REFERENCE = '.posthog-wizard-cache/reference/integration-nextjs';

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
  let scanned: string[] = [];
  let unavailable: { skill: string; reason: string }[] = [];

  const write = (root: string, files: Record<string, string>) => {
    for (const [file, contents] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), contents);
    }
  };
  const skillFile = (id: string, file: string) =>
    path.join(dir, SKILLS_ROOT, id, file);
  const read = (id: string, file: string): string | undefined =>
    fs.existsSync(skillFile(id, file))
      ? fs.readFileSync(skillFile(id, file), 'utf8')
      : undefined;

  /** Unpacks a skill the way the installer does: over whatever is in its folder. */
  const install = (id: string): Promise<InstallSkillResult> => {
    installed.push(id);
    write(path.join(dir, SKILLS_ROOT, id), { 'SKILL.md': STEP });
    return Promise.resolve({ kind: 'ok', path: `${SKILLS_ROOT}/${id}` });
  };

  const run = (overrides: Partial<RepackagedSkillRun> = {}) =>
    repackagedSkillInstaller({
      installDir: dir,
      skillsRoot: SKILLS_ROOT,
      referencePath: REFERENCE,
      install,
      scanFile: (file) => {
        scanned.push(file);
        return Promise.resolve(null);
      },
      onUnavailable: (skill, reason) =>
        unavailable.push({ skill: skill.id, reason }),
      ...overrides,
    });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repackaged-installer-'));
    installed = [];
    scanned = [];
    unavailable = [];
    write(path.join(dir, REFERENCE), PACK);
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('installs the skill, completes it from the pack and scans the SKILL.md it rewrote', async () => {
    expect(await run()(INSTALL)).toBe(`${SKILLS_ROOT}/${INSTALL.id}`);

    expect(read(INSTALL.id, 'SKILL.md')).toBe(COMPLETED);
    expect(read(INSTALL.id, 'references/next-js.md')).toBe('the library page');
    expect(scanned).toEqual([skillFile(INSTALL.id, 'SKILL.md')]);
    expect(unavailable).toEqual([]);
  });

  it('installs a skill once, however many tasks name it', async () => {
    const installer = run();

    await Promise.all([installer(INSTALL), installer(INSTALL)]);

    expect(installed).toEqual([INSTALL.id]);
  });

  it('empties the folder first, so a page an earlier run left does not replace the pack page', async () => {
    write(path.join(dir, SKILLS_ROOT, INSTALL.id), {
      'references/next-js.md': 'an earlier release',
    });

    await run()(INSTALL);

    expect(read(INSTALL.id, 'references/next-js.md')).toBe('the library page');
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

  // The id comes from the menu, and it names a folder the installer removes.
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

  it('refuses the skill and deletes it when the pack cannot complete it', async () => {
    fs.rmSync(path.join(dir, REFERENCE, 'variant.json'));

    await expect(run()(INSTALL)).rejects.toThrow(
      'the pack has no variant.json',
    );

    expect(fs.existsSync(path.join(dir, SKILLS_ROOT, INSTALL.id))).toBe(false);
    expect(scanned).toEqual([]);
    expect(unavailable).toEqual([
      { skill: INSTALL.id, reason: 'the pack has no variant.json' },
    ]);
  });

  it.each([
    [
      'the scan rejects the completed skill',
      () => Promise.resolve('prompt injection in SKILL.md'),
      'prompt injection in SKILL.md',
    ],
    [
      'the scan fails',
      () => Promise.reject(new Error('engine unavailable')),
      'scan failed: engine unavailable',
    ],
  ])(
    'refuses the skill and deletes the completed one when %s',
    async (_, scanFile, reason) => {
      await expect(run({ scanFile })(INSTALL)).rejects.toThrow(reason);

      expect(fs.existsSync(path.join(dir, SKILLS_ROOT, INSTALL.id))).toBe(
        false,
      );
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
});
