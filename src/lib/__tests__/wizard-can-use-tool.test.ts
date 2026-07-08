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

// Scoped file deletion — parity with the claude-agent-sdk harness, where a
// plain `rm <file>` works. Skills direct the agent to delete its own
// bookkeeping files (the event plan) at the end of a run; anything beyond a
// bare relative file path stays blocked.
describe('wizardCanUseTool — scoped rm', () => {
  const bash = (command: string) => wizardCanUseTool('Bash', { command });

  it('allows deleting a relative project file', () => {
    expect(bash('rm .posthog-events.json').behavior).toBe('allow');
    expect(bash('rm src/tmp/plan.json').behavior).toBe('allow');
  });

  it('allows -f and multiple bare paths', () => {
    expect(bash('rm -f .posthog-events.json').behavior).toBe('allow');
    expect(bash('rm a.txt b.txt').behavior).toBe('allow');
  });

  it('denies recursive and flagged variants', () => {
    expect(bash('rm -rf node_modules').behavior).toBe('deny');
    expect(bash('rm -r src').behavior).toBe('deny');
    expect(bash('rm --force x.txt').behavior).toBe('deny');
    expect(bash('rm -f -r x').behavior).toBe('deny');
  });

  it('denies globs, absolute, home, and traversal paths', () => {
    expect(bash('rm *.json').behavior).toBe('deny');
    expect(bash('rm /etc/passwd').behavior).toBe('deny');
    expect(bash('rm ~/x.txt').behavior).toBe('deny');
    expect(bash('rm ../outside.txt').behavior).toBe('deny');
    expect(bash('rm src/../../outside.txt').behavior).toBe('deny');
  });

  it('denies deleting .env files', () => {
    expect(bash('rm .env').behavior).toBe('deny');
    expect(bash('rm config/.env.local').behavior).toBe('deny');
  });

  it('denies rm with no path', () => {
    expect(bash('rm').behavior).toBe('deny');
    expect(bash('rm -f').behavior).toBe('deny');
  });
});
