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

describe('buildSourceMapsUploadPrompt hand-off report', () => {
  it('instructs the agent to publish the hand-off with publish_handoff', () => {
    const prompt = buildSourceMapsUploadPrompt(baseParams);

    expect(prompt).toContain('`publish_handoff`');
    expect(prompt).toContain('`content`');
  });

  it('never tells the agent to write the report to a file', () => {
    // The report reaches the user as a notebook; a report file only exists
    // when publish_handoff's own fallback fires, which the agent never drives.
    const prompt = buildSourceMapsUploadPrompt({
      ...baseParams,
      projectPath: 'backend',
    });

    expect(prompt).toContain('do not write the report to a file');
    expect(prompt).not.toContain('posthog-source-maps-report.md');
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
