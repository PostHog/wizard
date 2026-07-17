import { buildSourceMapsUploadPrompt } from '@lib/programs/error-tracking-upload-source-maps/prompt';

const baseParams = {
  displayName: 'Node.js',
  variant: 'node' as const,
  skillId: 'error-tracking-upload-source-maps-node',
  projectId: 123,
  host: 'https://us.i.posthog.com',
  settingsUrl: 'https://us.posthog.com/settings/user-api-keys',
  uiHost: 'https://us.posthog.com',
};

describe('buildSourceMapsUploadPrompt env file paths', () => {
  it('scopes env tools to the selected monorepo project', () => {
    const prompt = buildSourceMapsUploadPrompt({
      ...baseParams,
      projectPath: 'backend',
    });

    expect(prompt).toContain(
      "Project directory (relative to the wizard's working directory): backend",
    );
    expect(prompt).toContain('pass `backend/.env`, not `.env`');
  });

  it.each([undefined, '.'])(
    'keeps root-project env files at the wizard working directory (%s)',
    (projectPath) => {
      const prompt = buildSourceMapsUploadPrompt({
        ...baseParams,
        projectPath,
      });

      expect(prompt).toContain('pass `.env`');
      expect(prompt).not.toContain('pass `./.env`');
    },
  );
});
