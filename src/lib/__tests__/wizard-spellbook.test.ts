import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Integration } from '../constants';
import type { ProgramConfig } from '../programs/program-step';
import { getProgramConfig, Program } from '../programs/program-registry';
import { buildAgentRunContext, buildSession } from '../wizard-session';
import { writeWizardSpellbook } from '../wizard-spellbook';
import { downloadSkill, fetchSkillMenu } from '../wizard-tools/tools';
import { InkUI } from '@ui/tui/ink-ui';
import { createServices } from '@ui/tui/screen-registry';
import { WizardStore } from '@ui/tui/store';

vi.mock('../wizard-tools/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../wizard-tools/tools')>()),
  fetchSkillMenu: vi.fn(),
  downloadSkill: vi.fn(),
}));

const program: ProgramConfig = {
  id: 'example-setup',
  description: 'Set up the example integration.',
  agentFlow: 'example-flow',
  steps: [],
};

const skill = {
  id: 'example-skill',
  name: 'Example skill',
  downloadUrl: 'https://example.com/skill.zip',
};

describe('writeWizardSpellbook', () => {
  let installDir: string;

  beforeEach(async () => {
    installDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'wizard-spellbook-test-'),
    );
    vi.clearAllMocks();
    vi.mocked(fetchSkillMenu).mockResolvedValue(null);
    vi.mocked(downloadSkill).mockResolvedValue({ success: true });
  });

  afterEach(async () => {
    await fs.rm(installDir, { recursive: true, force: true });
  });

  it('leaves useful instructions without credentials or a successful network request', async () => {
    const session = buildSession({ installDir });
    session.apiKey = 'personal-api-secret';
    session.email = 'private-user@example.com';
    session.frameworkContext = { secret: 'framework-secret' };
    session.credentials = {
      accessToken: 'access-token-secret',
      refreshToken: 'refresh-token-secret',
    } as typeof session.credentials;
    const dynamicRun = vi.fn();

    const result = await writeWizardSpellbook(session, {
      ...program,
      run: dynamicRun,
    });
    const readme = await fs.readFile(result.path, 'utf8');

    expect(result.skillsIncluded).toBe(false);
    expect(readme).toContain(program.description);
    expect(readme).toContain('https://posthog.com/docs');
    expect(readme).toContain('No matching skills could be downloaded');
    expect(readme).not.toMatch(/secret|private-user/);
    expect(downloadSkill).not.toHaveBeenCalled();
    expect(dynamicRun).not.toHaveBeenCalled();
  });

  it('downloads the selected skill without gateway triage and links the local instructions', async () => {
    vi.mocked(fetchSkillMenu).mockResolvedValue({
      categories: { skills: [skill] },
    });
    const session = buildSession({ installDir });
    session.skillId = skill.id;

    const result = await writeWizardSpellbook(session, program);

    expect(downloadSkill).toHaveBeenCalledExactlyOnceWith(
      skill,
      path.dirname(result.path),
      {
        skillsRoot: 'skills',
        triage: undefined,
      },
    );
    expect(result.skillsIncluded).toBe(true);
    expect(await fs.readFile(result.path, 'utf8')).toContain(
      '[example-skill](skills/example-skill/SKILL.md)',
    );
  });

  it('leaves a composed integration handoff in its child project using its own program', async () => {
    const store = new WizardStore(Program.SelfDriving);
    store.session = buildSession({ installDir });
    const child = buildSession({ installDir: path.join(installDir, 'app') });
    child.skillId = skill.id;
    child.apiKey = 'private-api-key';
    child.frameworkContext = { secret: 'private-framework-value' };
    vi.mocked(fetchSkillMenu).mockResolvedValue({
      categories: { skills: [skill] },
    });
    const context = buildAgentRunContext(child, Program.PostHogIntegration);
    new InkUI(store).setAgentRunContext(context);

    const result = await createServices(store).leaveSpellbook();
    const readme = await fs.readFile(result.path, 'utf8');

    expect(
      result.path.startsWith(
        path.join(child.installDir, '.posthog') + path.sep,
      ),
    ).toBe(true);
    expect(readme).toContain(
      getProgramConfig(Program.PostHogIntegration).description,
    );
    expect(readme).toContain(`Wizard program: ${Program.PostHogIntegration}`);
    expect(readme).not.toContain(`Wizard program: ${Program.SelfDriving}`);
    expect(JSON.stringify(context)).not.toContain('private-');
    expect(downloadSkill).toHaveBeenCalledExactlyOnceWith(
      skill,
      path.dirname(result.path),
      {
        skillsRoot: 'skills',
        triage: undefined,
      },
    );
    await expect(fs.stat(path.join(installDir, '.posthog'))).rejects.toThrow();
  });

  it('uses program metadata and the detected framework to select default variants', async () => {
    const session = buildSession({ installDir });
    session.integration = Integration.nextjs;
    const entry = (
      id: string,
      group: string,
      framework?: string,
      isDefault?: boolean,
    ) => ({
      ...skill,
      id,
      group,
      framework,
      default: isDefault,
    });
    const integration = entry(
      'integration-nextjs',
      'integration',
      'nextjs',
      true,
    );
    const setup = entry(
      'example-flow-setup-nextjs',
      'example-flow-setup',
      'nextjs',
      true,
    );
    const shared = entry('example-flow-finish', 'example-flow-finish');
    vi.mocked(fetchSkillMenu).mockResolvedValue({
      categories: {
        integration: [
          entry('integration-nextjs-alt', 'integration', 'nextjs'),
          integration,
        ],
        steps: [
          setup,
          shared,
          entry('example-flow-setup-django', 'example-flow-setup', 'django'),
          entry('unrelated-skill', 'other-flow', 'nextjs'),
          entry('../escaped', 'example-flow-unsafe'),
        ],
      },
    });

    await writeWizardSpellbook(session, program);

    expect(
      vi.mocked(downloadSkill).mock.calls.map(([selected]) => selected.id),
    ).toEqual([setup.id, shared.id]);
  });

  it('resolves a bare framework skill to its integration reference without using it for other programs', async () => {
    const session = buildSession({ installDir });
    session.integration = Integration.nextjs;
    session.skillId = Integration.nextjs;
    const reference = {
      ...skill,
      id: 'integration-nextjs-app-router',
      group: 'integration',
      framework: 'nextjs',
      default: true,
    };
    vi.mocked(fetchSkillMenu).mockResolvedValue({
      categories: { integration: [reference] },
    });

    await writeWizardSpellbook(session, program);
    expect(downloadSkill).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadSkill).mock.calls[0][0]).toEqual(reference);

    vi.mocked(downloadSkill).mockClear();
    await writeWizardSpellbook(session, {
      ...program,
      skillId: 'missing-audit-skill',
    });
    expect(downloadSkill).not.toHaveBeenCalled();
  });

  it('removes incomplete or rejected skills and reports a docs-only handoff', async () => {
    const session = buildSession({ installDir });
    session.skillId = skill.id;
    vi.mocked(fetchSkillMenu).mockResolvedValue({
      categories: { skills: [skill] },
    });
    vi.mocked(downloadSkill).mockImplementation(async (_skill, directory) => {
      const destination = path.join(directory, 'skills', skill.id);
      await fs.mkdir(destination, { recursive: true });
      await fs.writeFile(
        path.join(destination, 'SKILL.md'),
        'Partial unverified download',
      );
      return { success: false };
    });

    const result = await writeWizardSpellbook(session, program);

    expect(result.skillsIncluded).toBe(false);
    expect(await fs.readFile(result.path, 'utf8')).not.toContain('(skills/');
    await expect(
      fs.stat(path.join(path.dirname(result.path), 'skills', skill.id)),
    ).rejects.toThrow();
  });

  it('preserves earlier handoffs and existing project instructions', async () => {
    const existing = path.join(installDir, 'AGENTS.md');
    await fs.writeFile(existing, 'Project instructions');
    const session = buildSession({ installDir });
    const first = await writeWizardSpellbook(session, program);
    await fs.writeFile(first.path, 'Earlier handoff');

    const second = await writeWizardSpellbook(session, program);

    expect(second.path).not.toBe(first.path);
    expect(await fs.readFile(first.path, 'utf8')).toBe('Earlier handoff');
    expect(await fs.readFile(existing, 'utf8')).toBe('Project instructions');
  });
});
