import { isAbsolute, join } from 'node:path';
import { getExitLine } from '@ui/tui/exit-line';
import { WizardStore, Program } from '@ui/tui/store';
import { OutroKind } from '@lib/wizard-session';

vi.mock('../../../utils/analytics.js', () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  sessionProperties: vi.fn(() => ({})),
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

/** Force `tokenHudVisible` to `visible`, regardless of its IS_DEV default. */
function setHudVisible(store: WizardStore, visible: boolean): void {
  if (store.tokenHudVisible !== visible) store.toggleTokenHud();
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

  it('echoes the primary link and next-steps so they survive in scrollback', () => {
    const line = stripAnsi(
      getExitLine(
        storeWithOutro({
          kind: OutroKind.Success,
          message: 'Self-driving is on.',
          primaryLink: {
            label: 'Your Self-driving inbox',
            url: 'https://us.posthog.com/project/123/inbox',
          },
          nextSteps: {
            heading: 'In your inbox you can:',
            items: ['Review findings', 'Triage what matters'],
          },
        }),
      ),
    );

    expect(line).toContain('Self-driving is on.');
    expect(line).toContain('Your Self-driving inbox:');
    // URL sits on its own line (not glued to the label) for clean selection.
    expect(
      line
        .split('\n')
        .some((l) => l === 'https://us.posthog.com/project/123/inbox'),
    ).toBe(true);
    expect(line).toContain('In your inbox you can:');
    expect(line).toContain('• Review findings');
  });

  it('appends the report suffix with the resolved absolute path (not a bare ./)', () => {
    const store = storeWithOutro({
      kind: OutroKind.Success,
      message: 'Done!',
      reportFile: 'posthog-setup-report.md',
    });
    const line = stripAnsi(getExitLine(store));
    const expectedPath = join(
      store.session.installDir,
      'posthog-setup-report.md',
    );
    expect(line).toContain(`Check ${expectedPath} for details.`);
    // Absolute path so users who passed --install-dir look in the right place.
    expect(isAbsolute(expectedPath)).toBe(true);
    expect(line).not.toContain('./posthog-setup-report.md');
  });

  it('leaves an already-absolute report path (orchestrator queue fallback) untouched', () => {
    const abs = '/tmp/some-project/.posthog-wizard/queue.json';
    const line = stripAnsi(
      getExitLine(
        storeWithOutro({
          kind: OutroKind.Success,
          message: 'Done!',
          reportFile: abs,
        }),
      ),
    );
    expect(line).toContain(`Check ${abs} for details.`);
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

  describe('token/cost tally (hidden Ctrl+T HUD survives into scrollback)', () => {
    it('appends the running cost estimate on a success outro when the HUD is visible', () => {
      const store = storeWithOutro({
        kind: OutroKind.Success,
        message: 'Done!',
      });
      setHudVisible(store, true);
      store.addTokenUsage({
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        cacheCreation5m: 0,
        cacheCreation1h: 0,
      });

      const line = stripAnsi(getExitLine(store));

      expect(line).toContain('Cost (estimate): $3.00');
      expect(line).toContain('in 1.00M');
    });

    it('labels the tally "Final cost" once reconciled to the SDK total', () => {
      const store = storeWithOutro({
        kind: OutroKind.Success,
        message: 'Done!',
      });
      setHudVisible(store, true);
      store.addTokenUsage({
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        cacheCreation5m: 0,
        cacheCreation1h: 0,
      });
      store.setFinalTokenCostUsd(1.5);

      const line = stripAnsi(getExitLine(store));

      expect(line).toContain('Final cost: $1.50');
    });

    it('appends the tally after the "exited" line for non-success outcomes too', () => {
      const store = storeWithOutro({ kind: OutroKind.Error, message: 'boom' });
      setHudVisible(store, true);
      store.addTokenUsage({
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        cacheCreation5m: 0,
        cacheCreation1h: 0,
      });

      const line = stripAnsi(getExitLine(store));

      expect(line).toMatch(/exited\./);
      expect(line).toContain('Cost (estimate): $3.00');
    });

    it('omits the tally entirely when the run never produced any usage', () => {
      const store = storeWithOutro({
        kind: OutroKind.Success,
        message: 'Done!',
      });
      setHudVisible(store, true);

      const line = stripAnsi(getExitLine(store));

      expect(line).not.toContain('Cost');
    });

    it('omits the tally when the HUD was toggled off, even with usage to show', () => {
      // The user explicitly hid the HUD (or it's a production run, where it
      // defaults hidden) -- the cost tally shouldn't appear out of nowhere
      // in scrollback for someone who never asked to see it.
      const store = storeWithOutro({
        kind: OutroKind.Success,
        message: 'Done!',
      });
      setHudVisible(store, false);
      store.addTokenUsage({
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        cacheCreation5m: 0,
        cacheCreation1h: 0,
      });

      const line = stripAnsi(getExitLine(store));

      expect(line).not.toContain('Cost');
    });
  });
});
