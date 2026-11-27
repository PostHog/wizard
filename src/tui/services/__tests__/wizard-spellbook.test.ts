import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Integration } from '@shared/constants';
import type { ProgramConfig } from '@programs/types';
import { buildSession } from '@programs';
import { writeWizardSpellbook } from '../wizard-spellbook';
import { downloadSkill } from '@shared/skill-install';
import { fetchSkillMenu } from '@shared/skill-menu';

vi.mock(import('@shared/skill-install'), async (importOriginal) => ({
  ...(await importOriginal()),
  downloadSkill: vi.fn(),
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
    vi.mocked(downloadSkill).mockImplementation(async (_skill, directory) => {
      const destination = path.join(directory, 'skills', skill.id);
      await fs.mkdir(destination, { recursive: true });
      await fs.writeFile(path.join(destination, 'SKILL.md'), 'partial');
      return { success: false };
    });

    const rejected = await writeWizardSpellbook(session, program);
    expect(rejected.skillsIncluded).toBe(false);
    expect(rejected.path).not.toBe(offline.path);
    expect(await fs.readFile(rejected.path, 'utf8')).not.toContain('(skills/');
    await expect(
      fs.stat(path.join(path.dirname(rejected.path), 'skills', skill.id)),
    ).rejects.toThrow();
  });

  it('uses top-level program.docsUrl when program.run is a function', async () => {
    vi.mocked(fetchSkillMenu).mockResolvedValue(null);
    const dynamicProgram: ProgramConfig = {
      id: 'ai-observability',
      description: 'Add PostHog AI Observability',
      docsUrl: 'https://posthog.com/docs/ai-observability',
      run: () =>
        Promise.resolve({
          integrationLabel: 'ai-observability',
          successMessage: 'done',
          reportFile: 'posthog-ai-observability-report.md',
          docsUrl: 'https://posthog.com/docs/ai-observability',
          spinnerMessage: 'working',
          estimatedDurationMinutes: 5,
        }),
    };

    const result = await writeWizardSpellbook(
      buildSession({ installDir }),
      dynamicProgram,
    );
    const content = await fs.readFile(result.path, 'utf8');
    expect(content).toContain('https://posthog.com/docs/ai-observability');
  });
});
