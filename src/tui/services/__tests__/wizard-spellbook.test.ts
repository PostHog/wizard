import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Integration } from '@shared/constants';
import type { ProgramConfig } from '@programs/types';
import {
  buildSession,
  FRAMEWORK_REGISTRY,
  POSTHOG_SDKS_KEY,
  scanInstalledSkill,
} from '@programs';
import { writeWizardSpellbook } from '../wizard-spellbook';
import { downloadSkill } from '@shared/skill-install';
import { fetchSkillMenu } from '@shared/skill-menu';

vi.mock(import('@shared/skill-install'), async (importOriginal) => ({
  ...(await importOriginal()),
  downloadSkill: vi.fn(),
}));
vi.mock('@programs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@programs')>()),
  scanInstalledSkill: vi.fn(),
}));
vi.mock('@shared/skill-menu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/skill-menu')>()),
  fetchSkillMenu: vi.fn(),
}));

const program: ProgramConfig = {
  id: 'example-setup',
  description: 'Set up the example integration.',
  agentFlow: 'example-flow',
};

const skill = {
  id: 'integration-nextjs',
  name: 'Next.js integration',
  downloadUrl: 'https://example.com/skill.zip',
  family: 'integration',
  tags: ['framework:nextjs', 'default'],
};

describe('writeWizardSpellbook', () => {
  let installDir: string;

  beforeEach(async () => {
    installDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'wizard-spellbook-test-'),
    );
    vi.clearAllMocks();
    vi.mocked(downloadSkill).mockResolvedValue({ success: true });
  });

  afterEach(async () => {
    await fs.rm(installDir, { recursive: true, force: true });
  });

  it('saves the framework skill, links it, and writes no secrets', async () => {
    const session = buildSession({ installDir });
    session.integration = Integration.nextjs;
    session.skillId = Integration.nextjs;
    session.apiKey = 'personal-api-secret';
    session.frameworkContext = { secret: 'framework-secret' };
    vi.mocked(fetchSkillMenu).mockResolvedValue({
      categories: {
        integration: [
          {
            ...skill,
            id: 'integration-nextjs-alt',
            tags: ['framework:nextjs'],
          },
          skill,
        ],
        unsafe: [{ ...skill, id: '../escaped', family: 'example-flow-unsafe' }],
      },
    });

    const result = await writeWizardSpellbook(session, program);
    const readme = await fs.readFile(result.path, 'utf8');

    expect(result.skillsIncluded).toBe(true);
    expect(
      result.path.startsWith(path.join(installDir, '.posthog') + path.sep),
    ).toBe(true);
    expect(downloadSkill).toHaveBeenCalledExactlyOnceWith(
      skill,
      path.dirname(result.path),
      { skillsRoot: 'skills', scan: expect.any(Function) },
    );
    expect(readme).toContain(program.description);
    expect(readme).toContain(`[${skill.id}](skills/${skill.id}/SKILL.md)`);
    expect(readme).not.toMatch(/secret/);
  });

  it("hands over the flow's own skills when no skill is named for the run", async () => {
    const session = buildSession({ installDir });
    session.integration = Integration.nextjs;
    session.skillId = 'not-on-the-menu';
    const entry = (id: string, family: string, tags: string[]) => ({
      ...skill,
      id,
      family,
      tags,
    });
    const first = entry('example-flow-install-a', 'example-flow-install', [
      'framework:nextjs',
    ]);
    const preferred = entry('example-flow-install-b', 'example-flow-install', [
      'framework:nextjs',
      'default',
    ]);
    const anyFramework = entry(
      'example-flow-report',
      'example-flow-report',
      [],
    );
    vi.mocked(fetchSkillMenu).mockResolvedValue({
      categories: {
        install: [first, preferred],
        report: [anyFramework],
        other: [
          entry('example-flow-install-nuxt', 'example-flow-install', [
            'framework:nuxt',
            'default',
          ]),
          entry('another-flow-install', 'another-flow-install', [
            'framework:nextjs',
          ]),
        ],
      },
    });

    await writeWizardSpellbook(session, program);

    expect(
      vi.mocked(downloadSkill).mock.calls.map(([picked]) => picked.id),
    ).toEqual([preferred.id, anyFramework.id]);
  });

  it('still leaves usable instructions when the menu or download fails', async () => {
    const session = buildSession({ installDir });
    session.skillId = skill.id;
    vi.mocked(fetchSkillMenu).mockResolvedValueOnce(null);

    const offline = await writeWizardSpellbook(session, program);
    expect(offline.skillsIncluded).toBe(false);
    expect(await fs.readFile(offline.path, 'utf8')).toContain(
      'https://posthog.com/docs',
    );
    expect(downloadSkill).not.toHaveBeenCalled();

    vi.mocked(fetchSkillMenu).mockResolvedValue({
      categories: { integration: [skill] },
    });
    // The real installer, handed an unusable archive, must leave nothing in the folder.
    const actual = await vi.importActual<
      typeof import('@shared/skill-install')
    >('@shared/skill-install');
    vi.mocked(downloadSkill).mockImplementation(actual.downloadSkill);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not a zip'))),
    );

    const rejected = await writeWizardSpellbook(session, program);
    expect(rejected.skillsIncluded).toBe(false);
    expect(rejected.path).not.toBe(offline.path);
    expect(await fs.readFile(rejected.path, 'utf8')).not.toContain('(skills/');
    await expect(
      fs.stat(path.join(path.dirname(rejected.path), 'skills', skill.id)),
    ).rejects.toThrow();
    vi.unstubAllGlobals();
  });

  it('never removes anything for a menu id that is not a plain name', async () => {
    const sentinel = path.join(installDir, 'sentinel.txt');
    await fs.writeFile(sentinel, 'safe');
    const session = buildSession({ installDir });
    session.skillId = 'not-on-the-menu';
    vi.mocked(fetchSkillMenu).mockResolvedValue({
      categories: {
        unsafe: [
          { ...skill, id: '../../..', family: 'example-flow-unsafe', tags: [] },
          {
            ...skill,
            id: '../escaped',
            family: 'example-flow-other',
            tags: [],
          },
        ],
      },
    });
    const actual = await vi.importActual<
      typeof import('@shared/skill-install')
    >('@shared/skill-install');
    vi.mocked(downloadSkill).mockImplementation(actual.downloadSkill);

    const result = await writeWizardSpellbook(session, program);

    expect(downloadSkill).not.toHaveBeenCalled();
    expect(result.skillsIncluded).toBe(false);
    expect(await fs.readFile(sentinel, 'utf8')).toBe('safe');
  });

  describe('which skills are handed over', () => {
    const entry = (
      id: string,
      family: string | undefined,
      tags: string[] = [],
    ) => ({
      ...skill,
      id,
      family,
      tags,
    });
    const ids = () =>
      vi.mocked(downloadSkill).mock.calls.map(([picked]) => picked.id);

    it('prefers the program skill id to the session one, and falls back to it', async () => {
      const session = buildSession({ installDir });
      session.skillId = 'skill-a';
      vi.mocked(fetchSkillMenu).mockResolvedValue({
        categories: {
          x: [entry('skill-a', 'skill-a'), entry('skill-b', 'skill-b')],
        },
      });

      await writeWizardSpellbook(session, { ...program, skillId: 'skill-b' });
      await writeWizardSpellbook(session, program);

      expect(ids()).toEqual(['skill-b', 'skill-a']);
    });

    it('takes the flow from the program id when it names no agent flow', async () => {
      const session = buildSession({ installDir });
      session.skillId = 'not-on-the-menu';
      vi.mocked(fetchSkillMenu).mockResolvedValue({
        categories: { x: [entry('example-flow-a', 'example-flow-a')] },
      });

      await writeWizardSpellbook(session, {
        id: 'example-flow',
        description: 'Flow by id.',
      });

      expect(ids()).toEqual(['example-flow-a']);
    });

    it('takes the flow family itself and its prefixed families, and keeps a default', async () => {
      const session = buildSession({ installDir });
      session.skillId = 'not-on-the-menu';
      vi.mocked(fetchSkillMenu).mockResolvedValue({
        categories: {
          x: [
            entry('no-family', undefined),
            entry('example-flow', 'example-flow'),
            entry('example-flowx', 'example-flowx'),
            entry('install-default', 'example-flow-install', ['default']),
            entry('install-other', 'example-flow-install'),
          ],
        },
      });

      await writeWizardSpellbook(session, program);

      expect(ids()).toEqual(['example-flow', 'install-default']);
    });

    it('runs the scan on every skill and fails closed when it flags one', async () => {
      const session = buildSession({ installDir });
      session.skillId = skill.id;
      vi.mocked(fetchSkillMenu).mockResolvedValue({
        categories: { integration: [skill] },
      });
      vi.mocked(scanInstalledSkill).mockResolvedValue('flagged');
      vi.mocked(downloadSkill).mockImplementation(
        async (_skill, _dir, options) => ({
          success: (await options.scan('/skill-dir')) === null,
        }),
      );

      const result = await writeWizardSpellbook(session, program);

      expect(scanInstalledSkill).toHaveBeenCalledExactlyOnceWith(
        '/skill-dir',
        undefined,
      );
      expect(result.skillsIncluded).toBe(false);
    });

    it('asks for the menu once, with a short timeout', async () => {
      const session = buildSession({ installDir });
      vi.mocked(fetchSkillMenu).mockResolvedValue(null);

      await writeWizardSpellbook(session, program);

      expect(fetchSkillMenu).toHaveBeenCalledExactlyOnceWith(
        expect.any(String),
        { timeoutMs: 10_000, maxAttempts: 1 },
      );
    });
  });

  it('installs multi-major SDK skills when sdkSupport is enabled and skips them when disabled', async () => {
    const sdkMenu = {
      categories: {
        integration: [skill],
        'sdk/posthog-node': [
          {
            id: 'sdk-posthog-node-v5',
            name: 'PostHog Node v5',
            downloadUrl: 'https://example.com/node-v5.zip',
            family: 'sdk-posthog-node',
            tags: ['sdkNode:5', 'sdk-posthog-node'],
          },
          {
            id: 'sdk-posthog-node-v6',
            name: 'PostHog Node v6',
            downloadUrl: 'https://example.com/node-v6.zip',
            family: 'sdk-posthog-node',
            tags: ['sdkNode:6', 'sdk-posthog-node', 'default'],
          },
        ],
      },
    };
    const session = buildSession({ installDir });
    session.integration = Integration.nextjs;
    session.skillId = Integration.nextjs;
    session.frameworkConfig = FRAMEWORK_REGISTRY[Integration.nextjs];
    session.frameworkContext = {
      [POSTHOG_SDKS_KEY]: [
        {
          key: 'posthog-node',
          packageName: 'posthog-node',
          major: 5,
          constraintKind: 'range',
          rawSpec: '^5.28.1',
          source: 'apps/api/package.json',
        },
        {
          key: 'posthog-node',
          packageName: 'posthog-node',
          major: 6,
          constraintKind: 'range',
          rawSpec: '^6.0.0',
          source: 'apps/web/package.json',
        },
      ],
    };

    vi.mocked(fetchSkillMenu).mockResolvedValueOnce(sdkMenu);
    const sdkResult = await writeWizardSpellbook(session, {
      ...program,
      sdkSupport: true,
    });
    const sdkReadme = await fs.readFile(sdkResult.path, 'utf8');
    expect(sdkReadme).toContain('sdk-posthog-node-v5/SKILL.md');
    expect(sdkReadme).toContain('sdk-posthog-node-v6/SKILL.md');
    expect(
      vi.mocked(downloadSkill).mock.calls.map(([picked]) => picked.id),
    ).toEqual([skill.id, 'sdk-posthog-node-v5', 'sdk-posthog-node-v6']);

    // Greenfield sdkSupport program resolves default SDK skill via FrameworkConfig.metadata.sdkSkillFamily.
    vi.mocked(downloadSkill).mockClear();
    const greenfieldSession = buildSession({ installDir });
    greenfieldSession.integration = Integration.nextjs;
    greenfieldSession.skillId = Integration.nextjs;
    greenfieldSession.frameworkConfig = FRAMEWORK_REGISTRY[Integration.nextjs];
    vi.mocked(fetchSkillMenu).mockResolvedValueOnce(sdkMenu);
    await writeWizardSpellbook(greenfieldSession, {
      ...program,
      sdkSupport: true,
    });
    expect(
      vi.mocked(downloadSkill).mock.calls.map(([picked]) => picked.id),
    ).toEqual([skill.id, 'sdk-posthog-node-v6']);

    // Non-sdkSupport program omits SDK skills even when session retains posthogSdks and integration.
    vi.mocked(downloadSkill).mockClear();
    vi.mocked(fetchSkillMenu).mockResolvedValueOnce(sdkMenu);
    const nonSdkResult = await writeWizardSpellbook(session, {
      ...program,
      sdkSupport: false,
    });
    const nonSdkReadme = await fs.readFile(nonSdkResult.path, 'utf8');
    expect(nonSdkReadme).not.toContain('sdk-posthog-node');
    expect(
      vi.mocked(downloadSkill).mock.calls.map(([picked]) => picked.id),
    ).toEqual([skill.id]);
  });

  describe('scoped programs and shared helpers', () => {
    const nodeSkill = (major: number, extra: string[] = []) => ({
      id: `sdk-posthog-node-v${major}`,
      name: `PostHog Node v${major}`,
      downloadUrl: `https://example.com/node-v${major}.zip`,
      family: 'sdk-posthog-node',
      tags: [`sdkNode:${major}`, 'sdk-posthog-node', ...extra],
    });
    const sdkMenu = {
      categories: {
        integration: [skill],
        sdk: [nodeSkill(5), nodeSkill(6, ['default'])],
      },
    };

    it('scans and writes at the target dir of a scoped sdkSupport program', async () => {
      const sub = path.join(installDir, 'apps', 'api');
      await fs.mkdir(sub, { recursive: true });
      await fs.writeFile(
        path.join(sub, 'package.json'),
        JSON.stringify({ dependencies: { 'posthog-node': '^5.0.0' } }),
      );
      // A stale root scan must not stand in for the target dir's.
      const session = buildSession({ installDir });
      session.integration = Integration.nextjs;
      session.skillId = Integration.nextjs;
      session.frameworkConfig = FRAMEWORK_REGISTRY[Integration.nextjs];
      session.frameworkContext = { [POSTHOG_SDKS_KEY]: [] };
      vi.mocked(fetchSkillMenu).mockResolvedValueOnce(sdkMenu);

      const result = await writeWizardSpellbook(session, {
        ...program,
        sdkSupport: true,
        runSteps: { run: { targetDir: () => sub } },
      });

      expect(result.path.startsWith(path.join(sub, '.posthog'))).toBe(true);
      expect(
        vi.mocked(downloadSkill).mock.calls.map(([picked]) => picked.id),
      ).toEqual([skill.id, 'sdk-posthog-node-v5']);
    });

    it('resolves the target dir range from the workspace-root lockfile', async () => {
      const sub = path.join(installDir, 'apps', 'api');
      await fs.mkdir(sub, { recursive: true });
      await fs.writeFile(
        path.join(installDir, 'pnpm-lock.yaml'),
        [
          'packages:',
          "  'posthog-node@5.12.0(typescript@5.0.0)':",
          '    resolution: {integrity: sha512-ph}',
        ].join('\n'),
      );
      await fs.writeFile(
        path.join(sub, 'package.json'),
        JSON.stringify({
          dependencies: { 'posthog-node': '^4.18.0 || ^5.0.0' },
        }),
      );
      const session = buildSession({ installDir });
      vi.mocked(fetchSkillMenu).mockResolvedValueOnce({
        categories: {
          sdk: [nodeSkill(4), nodeSkill(5, ['default'])],
        },
      });

      await writeWizardSpellbook(session, {
        ...program,
        sdkSupport: true,
        runSteps: { run: { targetDir: () => sub } },
      });

      expect(
        vi.mocked(downloadSkill).mock.calls.map(([picked]) => picked.id),
      ).toEqual(['sdk-posthog-node-v5']);
    });

    it('falls back to the skill id for the greenfield SDK family', async () => {
      const session = buildSession({ installDir });
      session.skillId = Integration.nextjs;
      vi.mocked(fetchSkillMenu).mockResolvedValueOnce(sdkMenu);

      await writeWizardSpellbook(session, { ...program, sdkSupport: true });

      expect(
        vi.mocked(downloadSkill).mock.calls.map(([picked]) => picked.id),
      ).toContain('sdk-posthog-node-v6');
    });

    const pinned = (major: number, source = 'a/package.json') => ({
      key: 'posthog-node',
      packageName: 'posthog-node',
      major,
      constraintKind: 'range',
      rawSpec: `^${major}.0.0`,
      source,
    });
    const downloaded = () =>
      vi.mocked(downloadSkill).mock.calls.map(([picked]) => picked.id);

    it('hands over no SDK skill for a project pinned to a major with no skill', async () => {
      const session = buildSession({ installDir });
      session.integration = Integration.nextjs;
      session.skillId = Integration.nextjs;
      session.frameworkContext = { [POSTHOG_SDKS_KEY]: [pinned(3)] };
      vi.mocked(fetchSkillMenu).mockResolvedValueOnce(sdkMenu);

      const result = await writeWizardSpellbook(session, {
        ...program,
        sdkSupport: true,
      });

      expect(downloaded()).toEqual([skill.id]);
      expect(await fs.readFile(result.path, 'utf8')).not.toContain(
        'sdk-posthog-node',
      );
    });

    it('scans the project for a run with no target dir and no scan yet', async () => {
      await fs.writeFile(
        path.join(installDir, 'package.json'),
        JSON.stringify({ dependencies: { 'posthog-node': '^5.0.0' } }),
      );
      const session = buildSession({ installDir });
      session.skillId = Integration.nextjs;
      session.frameworkContext = {};
      vi.mocked(fetchSkillMenu).mockResolvedValueOnce(sdkMenu);

      await writeWizardSpellbook(session, { ...program, sdkSupport: true });

      expect(downloaded()).toContain('sdk-posthog-node-v5');
      expect(downloaded()).not.toContain('sdk-posthog-node-v6');
      expect(session.frameworkContext).toEqual({});
    });

    it('keeps the scan a run with no target dir already has', async () => {
      await fs.writeFile(
        path.join(installDir, 'package.json'),
        JSON.stringify({ dependencies: { 'posthog-node': '^5.0.0' } }),
      );
      const session = buildSession({ installDir });
      session.skillId = Integration.nextjs;
      session.frameworkContext = { [POSTHOG_SDKS_KEY]: [pinned(6)] };
      vi.mocked(fetchSkillMenu).mockResolvedValueOnce(sdkMenu);

      await writeWizardSpellbook(session, { ...program, sdkSupport: true });

      expect(downloaded()).toContain('sdk-posthog-node-v6');
      expect(downloaded()).not.toContain('sdk-posthog-node-v5');
    });

    it('does not write the target dir scan into the live session', async () => {
      const sub = path.join(installDir, 'apps', 'api');
      await fs.mkdir(sub, { recursive: true });
      await fs.writeFile(
        path.join(sub, 'package.json'),
        JSON.stringify({ dependencies: { 'posthog-node': '^5.0.0' } }),
      );
      const session = buildSession({ installDir });
      session.skillId = Integration.nextjs;
      session.frameworkContext = { [POSTHOG_SDKS_KEY]: [pinned(6)] };
      vi.mocked(fetchSkillMenu).mockResolvedValueOnce(sdkMenu);

      await writeWizardSpellbook(session, {
        ...program,
        sdkSupport: true,
        runSteps: { run: { targetDir: () => sub } },
      });

      expect(session.frameworkContext[POSTHOG_SDKS_KEY]).toEqual([pinned(6)]);
      expect(session.installDir).toBe(installDir);
    });

    it('scopes a program without sdkSupport to its target dir', async () => {
      const sub = path.join(installDir, 'apps', 'api');
      await fs.mkdir(sub, { recursive: true });
      const session = buildSession({ installDir });
      session.skillId = skill.id;
      vi.mocked(fetchSkillMenu).mockResolvedValue(sdkMenu);

      const scoped = await writeWizardSpellbook(session, {
        ...program,
        runSteps: { run: { targetDir: () => sub } },
      });
      const unscoped = await writeWizardSpellbook(session, program);

      expect(scoped.path.startsWith(path.join(sub, '.posthog'))).toBe(true);
      expect(unscoped.path.startsWith(path.join(installDir, '.posthog'))).toBe(
        true,
      );
      expect(downloaded()).toEqual([skill.id, skill.id]);
    });

    it('downloads skills in parallel and keeps the selected order', async () => {
      const session = buildSession({ installDir });
      session.integration = Integration.nextjs;
      session.skillId = Integration.nextjs;
      session.frameworkContext = {
        [POSTHOG_SDKS_KEY]: [
          {
            key: 'posthog-node',
            packageName: 'posthog-node',
            major: 5,
            constraintKind: 'range',
            rawSpec: '^5.0.0',
            source: 'a/package.json',
          },
          {
            key: 'posthog-node',
            packageName: 'posthog-node',
            major: 6,
            constraintKind: 'range',
            rawSpec: '^6.0.0',
            source: 'b/package.json',
          },
        ],
      };
      vi.mocked(fetchSkillMenu).mockResolvedValueOnce(sdkMenu);
      let inFlight = 0;
      let peak = 0;
      vi.mocked(downloadSkill).mockImplementation(async (picked) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        // The first skill finishes last.
        await new Promise((r) =>
          setTimeout(r, picked.id === skill.id ? 30 : 1),
        );
        inFlight -= 1;
        return { success: true };
      });

      const result = await writeWizardSpellbook(session, {
        ...program,
        sdkSupport: true,
      });
      const readme = await fs.readFile(result.path, 'utf8');

      expect(peak).toBe(3);
      const links = [...readme.matchAll(/\(skills\/([^/]+)\/SKILL/g)].map(
        (m) => m[1],
      );
      expect(links).toEqual([
        skill.id,
        'sdk-posthog-node-v5',
        'sdk-posthog-node-v6',
      ]);
    });
  });
});
