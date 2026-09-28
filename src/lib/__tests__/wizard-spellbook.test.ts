import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Integration } from '@shared/constants';
import type { ProgramConfig } from '../../programs/program-step';
import { buildSession } from '../wizard-session';
import { writeWizardSpellbook } from '../wizard-spellbook';
import { downloadSkill } from '@agent/tools/tools';
import { fetchSkillMenu } from '@shared/skill-menu';

vi.mock('@agent/tools/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent/tools/tools')>()),
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
  steps: [],
};

const skill = {
  id: 'integration-nextjs',
  name: 'Next.js integration',
  downloadUrl: 'https://example.com/skill.zip',
  group: 'integration',
  framework: 'nextjs',
  default: true,
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
          { ...skill, id: 'integration-nextjs-alt', default: false },
          skill,
        ],
        unsafe: [{ ...skill, id: '../escaped', group: 'example-flow-unsafe' }],
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
      { skillsRoot: 'skills', triage: undefined },
    );
    expect(readme).toContain(program.description);
    expect(readme).toContain(`[${skill.id}](skills/${skill.id}/SKILL.md)`);
    expect(readme).not.toMatch(/secret/);
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
});
