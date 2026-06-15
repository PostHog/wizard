import { getExitLine } from '@ui/tui/exit-line';
import { WizardStore, Program } from '@ui/tui/store';
import { OutroKind } from '@lib/wizard-session';

jest.mock('../../../utils/analytics.js', () => ({
  analytics: {
    capture: jest.fn(),
    wizardCapture: jest.fn(),
    setTag: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
  },
  sessionProperties: jest.fn(() => ({})),
}));

// Strip ANSI so assertions read against plain text.
// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

function storeWithOutro(
  data: Parameters<WizardStore['setOutroData']>[0],
): WizardStore {
  const store = new WizardStore(Program.PostHogIntegration);
  store.setOutroData(data);
  return store;
}

describe('getExitLine', () => {
  it('echoes the handoff prompt on its own line so it survives in scrollback', () => {
    const prompt =
      'Read `posthog-setup-report.md` and work through the checklist.';
    const line = stripAnsi(
      getExitLine(
        storeWithOutro({
          kind: OutroKind.Success,
          message: 'Successfully installed PostHog!',
          handoffPrompt: prompt,
        }),
      ),
    );

    expect(line).toContain('Successfully installed PostHog!');
    expect(line).toContain('triple-click to select');
    expect(line).toContain(prompt);
    // Prompt sits on its own line (not glued to the label) for clean selection.
    expect(line.split('\n').some((l) => l === prompt)).toBe(true);
  });

  it('omits the handoff block when no prompt is set', () => {
    const line = stripAnsi(
      getExitLine(
        storeWithOutro({
          kind: OutroKind.Success,
          message: 'Successfully installed PostHog!',
        }),
      ),
    );

    expect(line).toContain('Successfully installed PostHog!');
    expect(line).not.toContain('coding agent');
    expect(line).not.toContain('\n');
  });

  it('appends the report suffix when the message does not already mention it', () => {
    const line = stripAnsi(
      getExitLine(
        storeWithOutro({
          kind: OutroKind.Success,
          message: 'Done!',
          reportFile: 'posthog-setup-report.md',
        }),
      ),
    );
    expect(line).toContain('Check ./posthog-setup-report.md for details.');
  });

  it('falls back to a default headline when the outro has no message', () => {
    const line = stripAnsi(
      getExitLine(storeWithOutro({ kind: OutroKind.Success })),
    );
    expect(line).toMatch(/completed successfully\.$/);
  });

  it('renders a plain "exited" line for non-success outcomes', () => {
    const line = stripAnsi(
      getExitLine(storeWithOutro({ kind: OutroKind.Error, message: 'boom' })),
    );
    expect(line).toMatch(/exited\.$/);
    expect(line).not.toContain('coding agent');
  });
});
