const { mockFetchSkillMenu } = vi.hoisted(() => ({
  mockFetchSkillMenu: vi.fn(),
}));

vi.mock(import('@shared/skill-menu'), () => ({
  fetchSkillMenu: mockFetchSkillMenu,
}));
vi.mock(import('@shared/errors'), async (importOriginal) => ({
  ...(await importOriginal()),
  emitWizardError: vi.fn(),
}));
vi.mock(import('@utils/analytics'), () => ({
  analytics: { wizardCapture: vi.fn(), flush: vi.fn() } as never,
}));

import { listSkills } from '../index';

// `skill list` ends through exitWith, so the code is what a script sees.
describe('listSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('resolves 1 when the registry is unreachable', async () => {
    mockFetchSkillMenu.mockResolvedValue(null);
    await expect(listSkills()).resolves.toBe(1);
  });

  it('resolves 0 when the catalog has no browsable skills', async () => {
    mockFetchSkillMenu.mockResolvedValue({ cliEntries: [] });
    await expect(listSkills()).resolves.toBe(0);
  });

  it('resolves 0 once the skills are printed', async () => {
    mockFetchSkillMenu.mockResolvedValue({
      cliEntries: [
        { skillId: 'audit-events', role: 'skill', description: 'Audit' },
      ],
    });
    await expect(listSkills()).resolves.toBe(0);
  });
});
