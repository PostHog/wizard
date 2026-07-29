import {
  buildSourceMapsUploadPrompt,
  SOURCE_MAPS_DETECTION_FAILED_PROMPT,
} from '@lib/programs/error-tracking-upload-source-maps/prompt';
import { SOURCE_MAPS_ABORT_CASES } from '@lib/programs/error-tracking-upload-source-maps/detect';

const baseParams = {
  displayName: 'Node.js',
  variant: 'node' as const,
  skillId: 'error-tracking-upload-source-maps-node',
  projectId: 123,
  host: 'https://us.i.posthog.com',
  settingsUrl: 'https://us.posthog.com/settings/user-api-keys',
  uiHost: 'https://us.posthog.com',
};

describe('unsupported-platform abort', () => {
  const reason = 'unsupported-platform';

  it('is the reason the detection-failed prompt tells the agent to emit', () => {
    expect(SOURCE_MAPS_DETECTION_FAILED_PROMPT).toContain(`[ABORT] ${reason}`);
  });

  it('renders a friendly outro instead of the raw token, and files no error', () => {
    // No match means the runner falls back to showing `reason` verbatim and
    // captures a WizardError for it.
    const matched = SOURCE_MAPS_ABORT_CASES.find((c) => c.match.test(reason));

    expect(matched).toBeDefined();
    expect(matched?.body).not.toContain(reason);
    expect(matched?.expected).toBe(true);
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
