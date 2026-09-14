import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Integration } from '../constants';
import { buildSession } from '../wizard-session';
import { writeWizardSpellbook } from '../wizard-spellbook';
import { downloadSkill, fetchSkillMenu } from '../wizard-tools/tools';

vi.mock('../wizard-tools/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../wizard-tools/tools')>()),
  fetchSkillMenu: vi.fn(),
  downloadSkill: vi.fn(),
}));

let installDir: string;
const skill = {
  id: 'integration-javascript_node',
  name: 'Node integration',
  group: 'integration',
  framework: 'javascript_node',
  downloadUrl: 'https://example.com/skill.zip',
};

beforeEach(async () => {
  installDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wizard-spellbook-'));
  await fs.mkdir(path.join(installDir, '.posthog'));
  vi.clearAllMocks();
  vi.mocked(downloadSkill).mockResolvedValue({ success: true });
});
afterEach(() => fs.rm(installDir, { recursive: true, force: true }));

it('saves the matching skill with no secrets and a fresh directory', async () => {
  const session = buildSession({ installDir });
  session.integration = Integration.javascriptNode;
  session.skillId = 'integration';
  session.apiKey = 'private-api-key';
  vi.mocked(fetchSkillMenu).mockResolvedValue({
    categories: { integration: [skill] },
  });

  const first = await writeWizardSpellbook(session);
  const text = await fs.readFile(first.path, 'utf8');
  expect(first.skillsIncluded).toBe(true);
  expect(first.path.startsWith(installDir + path.sep)).toBe(true);
  expect(text).toContain(`(skills/${skill.id}/SKILL.md)`);
  expect(text).not.toContain('private-');
  expect(downloadSkill).toHaveBeenCalledTimes(1);

  const second = await writeWizardSpellbook(session);
  expect(second.path).not.toBe(first.path);
  expect(await fs.readFile(first.path, 'utf8')).toBe(text);
});

it('keeps usable instructions when the menu is unavailable', async () => {
  const session = buildSession({ installDir });
  session.skillId = 'integration';
  vi.mocked(fetchSkillMenu).mockResolvedValue(null);

  const result = await writeWizardSpellbook(session);
  const text = await fs.readFile(result.path, 'utf8');
  expect(result.skillsIncluded).toBe(false);
  expect(text).not.toContain('(skills/');
  expect(text).toContain('https://posthog.com/docs');
  expect(downloadSkill).not.toHaveBeenCalled();
});

it('ignores skill ids that would escape the directory', async () => {
  const session = buildSession({ installDir });
  session.skillId = '../escape';
  vi.mocked(fetchSkillMenu).mockResolvedValue({
    categories: { skills: [{ ...skill, id: '../escape' }] },
  });

  const result = await writeWizardSpellbook(session);
  expect(result.skillsIncluded).toBe(false);
  expect(downloadSkill).not.toHaveBeenCalled();
});
