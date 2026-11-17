/** Each way the installer of a repackaged skill ends: installed, completed and scanned, or handed back to the skill the prompt names. */
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
  group: id,
  downloadUrl: `https://skills.test/${id}.zip`,
  ...rest,
});
const INSTALL = entry('integration-install', {
  replaces: 'flow-install',
  frameworkReferences: 'integration',
});
const KEPT = entry('integration-kept', { replaces: 'kept-skill' });

describe('repackagedSkillInstaller', () => {
  let dir = '';
  let installed: string[] = [];
  let scanned: string[] = [];
  let unavailable: { skill: string; name: string; reason: string }[] = [];

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
    write(path.join(dir, SKILLS_ROOT, id), {
      'SKILL.md': id === INSTALL.id ? STEP : 'kept, republished',
    });
    return Promise.resolve({ kind: 'ok', path: `${SKILLS_ROOT}/${id}` });
  };

  const run = (overrides: Partial<RepackagedSkillRun> = {}) =>
    repackagedSkillInstaller({
      entries: [INSTALL, KEPT],
      installDir: dir,
      skillsRoot: SKILLS_ROOT,
      referencePath: REFERENCE,
      install,
      scanFile: (file) => {
        scanned.push(file);
        return Promise.resolve(null);
      },
      onUnavailable: (replacement, name, reason) =>
        unavailable.push({ skill: replacement.id, name, reason }),
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

  it('installs the replacement, completes it from the pack and scans the SKILL.md it rewrote', async () => {
    expect(await run()('flow-install')).toBe(`${SKILLS_ROOT}/${INSTALL.id}`);

    expect(read(INSTALL.id, 'SKILL.md')).toBe(COMPLETED);
    expect(read(INSTALL.id, 'references/next-js.md')).toBe('the library page');
    expect(scanned).toEqual([skillFile(INSTALL.id, 'SKILL.md')]);
    expect(unavailable).toEqual([]);
  });

  it('installs a replacement no pack completes as it is', async () => {
    expect(await run({ referencePath: undefined })('kept-skill')).toBe(
      `${SKILLS_ROOT}/${KEPT.id}`,
    );

    expect(read(KEPT.id, 'SKILL.md')).toBe('kept, republished');
    expect(scanned).toEqual([]);
    expect(unavailable).toEqual([]);
  });

  it('installs nothing for a name the menu has no replacement for', async () => {
    expect(await run()('unreplaced-skill')).toBeUndefined();

    expect(installed).toEqual([]);
    expect(unavailable).toEqual([]);
  });

  it('installs a replacement once, however many tasks name it', async () => {
    const installer = run();

    await Promise.all([installer('flow-install'), installer('flow-install')]);

    expect(installed).toEqual([INSTALL.id]);
  });

  it('empties the folder first, so a page an earlier run left does not replace the pack page', async () => {
    write(path.join(dir, SKILLS_ROOT, INSTALL.id), {
      'references/next-js.md': 'an earlier release',
    });

    await run()('flow-install');

    expect(read(INSTALL.id, 'references/next-js.md')).toBe('the library page');
  });

  it('hands the task back when the run has no framework pack, and installs nothing', async () => {
    expect(
      await run({ referencePath: undefined })('flow-install'),
    ).toBeUndefined();

    expect(installed).toEqual([]);
    expect(unavailable).toEqual([
      { skill: INSTALL.id, name: 'flow-install', reason: 'no framework pack' },
    ]);
  });

  // The id comes from the menu, and it names a folder the installer removes.
  it.each(['../../src', '..', 'a/b'])(
    'removes and installs nothing for the menu id %j',
    async (id) => {
      write(path.join(dir, 'src'), { 'app.ts': 'the app' });
      const entries = [{ ...INSTALL, id }];

      expect(await run({ entries })('flow-install')).toBeUndefined();

      expect(fs.readFileSync(path.join(dir, 'src/app.ts'), 'utf8')).toBe(
        'the app',
      );
      expect(fs.existsSync(path.join(dir, REFERENCE, 'variant.json'))).toBe(
        true,
      );
      expect(installed).toEqual([]);
      expect(unavailable).toEqual([
        { skill: id, name: 'flow-install', reason: `unusable skill id: ${id}` },
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
  ])('hands the task back when %s', async (_, overrides, reason) => {
    const installer = run(overrides);

    expect(await installer('flow-install')).toBeUndefined();
    expect(await installer('flow-install')).toBeUndefined();

    // A replacement is reported once, however many tasks wait on it.
    expect(unavailable).toEqual([
      { skill: INSTALL.id, name: 'flow-install', reason },
    ]);
  });

  it('hands the task back and leaves the skill as installed when the pack cannot complete it', async () => {
    fs.rmSync(path.join(dir, REFERENCE, 'variant.json'));

    expect(await run()('flow-install')).toBeUndefined();

    expect(read(INSTALL.id, 'SKILL.md')).toBe(STEP);
    expect(scanned).toEqual([]);
    expect(unavailable).toEqual([
      {
        skill: INSTALL.id,
        name: 'flow-install',
        reason: 'the pack has no variant.json',
      },
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
    'hands the task back and deletes the completed skill when %s',
    async (_, scanFile, reason) => {
      expect(await run({ scanFile })('flow-install')).toBeUndefined();

      expect(fs.existsSync(path.join(dir, SKILLS_ROOT, INSTALL.id))).toBe(
        false,
      );
      expect(unavailable).toEqual([
        { skill: INSTALL.id, name: 'flow-install', reason },
      ]);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'hands the task back, and writes nothing through it, when the skills folder is a link',
    async () => {
      fs.mkdirSync(path.join(dir, 'outside', INSTALL.id), { recursive: true });
      fs.symlinkSync(path.join(dir, 'outside'), path.join(dir, SKILLS_ROOT));

      expect(await run()('flow-install')).toBeUndefined();

      expect(fs.readdirSync(path.join(dir, 'outside'))).toEqual([INSTALL.id]);
      expect(installed).toEqual([]);
      expect(unavailable).toEqual([
        {
          skill: INSTALL.id,
          name: 'flow-install',
          reason: `a skill path passes through a link: ${SKILLS_ROOT}`,
        },
      ]);
    },
  );
});
