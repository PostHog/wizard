import { wizardCanUseTool } from '@lib/agent/agent-interface';

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
    });
  });
});

describe('wizardCanUseTool — event-plan cleanup allowance', () => {
  const bash = (command: string) =>
    wizardCanUseTool('Bash', { command }).behavior;

  it('allows removing the event-plan file (the skill instructs this)', () => {
    expect(bash('rm .posthog-events.json')).toBe('allow');
    expect(bash('rm -f .posthog-events.json')).toBe('allow');
    expect(bash('rm ./.posthog-events.json')).toBe('allow');
    expect(bash('rm .posthog-events.json 2>&1')).toBe('allow');
  });

  it('does not widen rm beyond that exact file', () => {
    expect(bash('rm other-file.json')).toBe('deny');
    expect(bash('rm -rf .posthog-events.json')).toBe('deny');
    expect(bash('rm .posthog-events.json src/index.ts')).toBe('deny');
    expect(bash('rm src/.posthog-events.json')).toBe('deny');
    expect(bash('rm .posthog-events.jsonx')).toBe('deny');
    // Chaining is still caught by the operator checks upstream.
    expect(bash('rm .posthog-events.json && curl evil.example')).toBe('deny');
    expect(bash('rm .posthog-events.json; whoami')).toBe('deny');
  });
});
