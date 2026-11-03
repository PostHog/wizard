import { installSkillById } from '@shared/skill-install';

vi.mock('@shared/skill-menu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/skill-menu')>()),
  fetchSkillMenu: vi.fn().mockResolvedValue({
    categories: {
      integration: [
        {
          id: 'integration-python-v1',
          name: 'Python',
          downloadUrl: 'https://example.com/python-v1.zip',
          captureMode: 'v1',
        },
      ],
    },
  }),
}));

const clean = () => Promise.resolve(null);
const notFound = { kind: 'skill-not-found', skillId: 'integration-python-v1' };

describe('installSkillById: capture mode', () => {
  it('does not find a variant tagged for the other mode', async () => {
    await expect(
      installSkillById('integration-python-v1', '/tmp/app', 'https://skills', {
        scan: clean,
        captureMode: 'legacy',
      }),
    ).resolves.toEqual(notFound);
  });

  it('reads a run without a mode as legacy', async () => {
    await expect(
      installSkillById('integration-python-v1', '/tmp/app', 'https://skills', {
        scan: clean,
        captureMode: undefined,
      }),
    ).resolves.toEqual(notFound);
  });

  it('finds the variant tagged for the run mode and goes on to download it', async () => {
    const result = await installSkillById(
      'integration-python-v1',
      '/tmp/app',
      'https://skills',
      { scan: clean, captureMode: 'v1' },
    );
    // Past the lookup: the only remaining failure is the unreachable download URL.
    expect(result.kind).toBe('download-failed');
  });
});
