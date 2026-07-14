import { wizardCanUseTool } from '@lib/agent/agent-interface';
import { analytics } from '@utils/analytics';

vi.mock('../../utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
  },
}));
vi.mock('../../utils/debug');

describe('wizardCanUseTool — wizard_ask pending guard', () => {
  for (const tool of ['Write', 'Edit'] as const) {
    it(`denies ${tool} while a wizard_ask overlay is pending`, () => {
      const result = wizardCanUseTool(
        tool,
        { file_path: 'src/app.ts', content: 'x' },
        { wizardAskPending: true },
      );
      expect(result).toEqual({
        behavior: 'deny',
        message: expect.stringMatching(/wizard_ask question is open/),
        reason: 'wizard_ask pending',
      });
    });

    it(`allows ${tool} when no overlay is pending`, () => {
      const result = wizardCanUseTool(
        tool,
        { file_path: 'src/app.ts', content: 'x' },
        { wizardAskPending: false },
      );
      expect(result.behavior).toBe('allow');
    });
  }

  it('still allows Read while a wizard_ask overlay is pending (read-only is safe)', () => {
    const result = wizardCanUseTool(
      'Read',
      { file_path: 'src/app.ts' },
      { wizardAskPending: true },
    );
    expect(result.behavior).toBe('allow');
  });

  it('defaults to no guard when context is omitted (preserves pre-Phase-3 callers)', () => {
    const result = wizardCanUseTool('Write', { file_path: 'src/app.ts' });
    expect(result.behavior).toBe('allow');
  });

  it('still denies Write on .env files even when no overlay is pending', () => {
    const result = wizardCanUseTool('Write', { file_path: '.env.local' });
    expect(result).toEqual({
      behavior: 'deny',
      message: expect.stringMatching(/wizard-tools MCP server/),
      reason: 'env file',
    });
  });
});

describe('wizardCanUseTool — bash policy', () => {
  it('is a pure predicate — never emits analytics itself', () => {
    // Telemetry is the caller's job (captureBashDenied), so the decision
    // function stays free of side effects and can be reused by both harnesses.
    (analytics.wizardCapture as ReturnType<typeof vi.fn>).mockClear();
    wizardCanUseTool('Bash', { command: 'rm -rf /' });
    wizardCanUseTool('Bash', { command: 'npm run test' });
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
  });

  it('tags each denial with a machine-readable reason', () => {
    expect(wizardCanUseTool('Bash', { command: 'npm run test' })).toMatchObject(
      { behavior: 'deny', reason: 'not in allowlist' },
    );
    expect(
      wizardCanUseTool('Bash', { command: 'npm run lint -- app/(x)/p.tsx' }),
    ).toMatchObject({ behavior: 'deny', reason: 'dangerous operators' });
  });

  it('allows a plain rm of a project file when workingDirectory is set', () => {
    const root = '/project';
    expect(
      wizardCanUseTool(
        'Bash',
        { command: 'rm .posthog-events.json' },
        { workingDirectory: root },
      ).behavior,
    ).toBe('allow');
    // …but not without a root to contain against, nor for an escaping path.
    expect(
      wizardCanUseTool('Bash', { command: 'rm .posthog-events.json' }).behavior,
    ).toBe('deny');
    expect(
      wizardCanUseTool(
        'Bash',
        { command: 'rm ../secret' },
        { workingDirectory: root },
      ).behavior,
    ).toBe('deny');
  });
});
