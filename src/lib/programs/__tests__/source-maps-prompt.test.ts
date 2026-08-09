import { buildSourceMapsUploadPrompt } from '@lib/programs/error-tracking-upload-source-maps/prompt';

const baseParams = {
  displayName: 'Node.js',
  variant: 'node' as const,
  skillId: 'error-tracking-upload-source-maps-node',
  projectId: 123,
  host: 'https://us.i.posthog.com',
  settingsUrl: 'https://us.posthog.com/settings/user-api-keys',
  uiHost: 'https://us.posthog.com',
  reportFile: 'posthog-source-maps-report.md',
};

describe('buildSourceMapsUploadPrompt hand-off report', () => {
  it('instructs the agent to write the report file the outro points at', () => {
    const prompt = buildSourceMapsUploadPrompt(baseParams);

    expect(prompt).toContain('Write the hand-off to');
    expect(prompt).toContain('`posthog-source-maps-report.md`');
  });

  it('pins the report to the wizard working directory for monorepo projects', () => {
    // The outro resolves reportFile against installDir, so a `backend/`
    // scoped run must still write the report at the working directory.
    const prompt = buildSourceMapsUploadPrompt({
      ...baseParams,
      projectPath: 'backend',
    });

    expect(prompt).toContain("WIZARD'S WORKING DIRECTORY");
    expect(prompt).toContain('never prefixed with the selected');
  });
});

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

describe('buildSourceMapsUploadPrompt non-interactive mode', () => {
  const prompt = buildSourceMapsUploadPrompt({
    ...baseParams,
    nonInteractive: true,
  });

  it('never references the ask tool or the API-key prompt', () => {
    expect(prompt).not.toContain('wizard_ask');
    expect(prompt).not.toContain('secretRef');
    expect(prompt).not.toContain('Paste your PostHog personal API key');
  });

  it('drops the local-test offer', () => {
    expect(prompt).not.toContain('Test the local setup');
    expect(prompt).not.toContain('Want me to help you test');
  });

  it('forbids real env files and env tools, allowing only committed examples', () => {
    expect(prompt).toContain('NEVER read, create, or modify real env files');
    expect(prompt).toContain('never call check_env_keys or set_env_values');
    expect(prompt).toContain('committed env example file');
    expect(prompt).not.toContain('Then call set_env_values');
  });

  it('routes dependency changes through the package manager', () => {
    // A package.json edit without its lockfile fails npm ci in the PR.
    expect(prompt).toContain(
      'Dependency changes go through the package manager',
    );
    expect(prompt).toContain('lockfile');
  });

  it('hands the API key off as a documented follow-up', () => {
    expect(prompt).toContain('you\ncannot obtain one');
    expect(prompt).toContain('"What you still need to do"');
    expect(prompt).toContain(baseParams.settingsUrl);
  });

  it('keeps the monorepo scope rules', () => {
    const monorepoPrompt = buildSourceMapsUploadPrompt({
      ...baseParams,
      projectPath: 'backend',
      nonInteractive: true,
    });

    expect(monorepoPrompt).toContain('scope your work to `backend`');
    expect(monorepoPrompt).toContain(
      "Project directory (relative to the wizard's working directory): backend",
    );
  });

  it('leaves the interactive prompt untouched', () => {
    const interactive = buildSourceMapsUploadPrompt(baseParams);

    expect(interactive).toContain('wizard_ask');
    expect(interactive).toContain('Test the local setup');
    expect(interactive).toContain('secretRef');
  });
});
