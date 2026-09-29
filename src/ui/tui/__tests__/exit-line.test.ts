import fs from 'fs';
import os from 'os';
import path from 'path';
import { getExitLine } from '@ui/tui/exit-line';
import { buildSession } from '@lib/wizard-session';
import { WizardStore, Program } from '@ui/tui/store';
import { OutroKind } from '@lib/wizard-session';
import { HostResolution } from '@shared/host-resolution';

vi.mock('@utils/analytics.js', () => ({
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
  it('keeps the saved skill path and contact in scrollback after a failed run', () => {
    const path = '/project/.posthog/wizard-spellbook-123/README.md';
    const store = storeWithOutro({ kind: OutroKind.Error, message: 'boom' });
    store.setCredentials({
      accessToken: 'tok',
      projectApiKey: 'pk',
      host: HostResolution.fromApiHost('https://app.posthog.com'),
      projectId: 1,
    });
    store.setSpellbook({ path, skillsIncluded: true });
    const line = stripAnsi(getExitLine(store));
    const lines = line.split('\n');
    expect(lines).toContain(path);
    expect(line).toContain('wizard@posthog.com');
    // The log path sits on the line after the contact copy.
    expect(lines[lines.indexOf(path) + 3]).toMatch(/\S/);
    expect(line).not.toContain('successfully');
  });

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
    expect(line).not.toContain('\n');
  });

  it('echoes the primary link URL on its own line so it survives in scrollback', () => {
    const line = stripAnsi(
      getExitLine(
        storeWithOutro({
          kind: OutroKind.Success,
          message: 'Self-driving is on.',
          primaryLink: {
            label: 'Your Self-driving inbox',
            url: 'https://us.posthog.com/project/123/inbox',
          },
        }),
      ),
    );

    // URL sits on its own line (not glued to the label) for clean selection.
    expect(
      line
        .split('\n')
        .some((l) => l === 'https://us.posthog.com/project/123/inbox'),
    ).toBe(true);
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

    it('appends the tally for non-success outcomes too', () => {
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

describe('getExitLine needs-attention block', () => {
  const block =
    '# Report\n\n> ⚠️ **Needs your attention**\n> - Load `.env` in the app.\n';

  it('leads a successful exit with the handoff warning items', () => {
    const store = storeWithOutro({
      kind: OutroKind.Success,
      message: 'Error tracking configured!',
    });
    store.setHandoffText(block);
    const lines = stripAnsi(getExitLine(store)).split('\n');
    expect(lines.slice(0, 2)).toEqual([
      '⚠ Needs your attention:',
      '  • Load `.env` in the app.',
    ]);
    expect(lines).toContain('✔ Error tracking configured!');
  });

  it('keeps the items when the user exits before the outro', () => {
    const store = new WizardStore(Program.PostHogIntegration);
    store.setHandoffText(block);
    const line = stripAnsi(getExitLine(store));
    expect(line).toContain('⚠ Needs your attention:');
    expect(line).toContain('exited.');
  });

  it('reads the items from the report file when nothing was published', () => {
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exit-line-'));
    try {
      fs.writeFileSync(path.join(installDir, 'report.md'), block);
      const store = new WizardStore(Program.PostHogIntegration);
      store.session = buildSession({ installDir });
      store.setOutroData({ kind: OutroKind.Success, reportFile: 'report.md' });
      expect(stripAnsi(getExitLine(store))).toContain(
        '  • Load `.env` in the app.',
      );
    } finally {
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  });

  it('adds nothing when the report has no warning block', () => {
    const store = storeWithOutro({ kind: OutroKind.Success, message: 'Done' });
    store.setHandoffText('# Report\n\nAll done.');
    expect(stripAnsi(getExitLine(store))).not.toContain('Needs your attention');
  });
});
