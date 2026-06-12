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
