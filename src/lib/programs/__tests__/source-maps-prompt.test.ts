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

describe('buildSourceMapsUploadPrompt rust workspace scope', () => {
  const rustParams = {
    ...baseParams,
    displayName: 'Rust',
    variant: 'rust' as const,
    skillId: 'error-tracking-upload-source-maps-rust',
  };

  it('exempts the Cargo workspace root when a member project is selected', () => {
    const prompt = buildSourceMapsUploadPrompt({
      ...rustParams,
      projectPath: 'rust/cymbal',
    });

    expect(prompt).toContain('Cargo workspace exception');
    expect(prompt).toContain('cargo locate-project --workspace');
    // The env-path rule must carry the same exception, or STEP 5 writes the
    // key into the member while the workspace upload reads the root .env.
    expect(prompt).toContain(
      'when the skill places the env file at the workspace root',
    );
  });

  it('omits the workspace exception for root-scoped rust projects', () => {
    const prompt = buildSourceMapsUploadPrompt({
      ...rustParams,
      projectPath: '.',
    });

    expect(prompt).not.toContain('Cargo workspace exception');
  });

  it('omits the workspace exception for non-rust monorepo projects', () => {
    const prompt = buildSourceMapsUploadPrompt({
      ...baseParams,
      projectPath: 'backend',
    });

    expect(prompt).not.toContain('Cargo workspace exception');
  });
});
