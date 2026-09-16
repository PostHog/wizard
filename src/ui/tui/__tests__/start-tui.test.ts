import { startTUI } from '@ui/tui/start-tui';
import { Program } from '@ui/tui/store';

// render() is the throw site: Ink's reconciler blows up on a react /
// react-reconciler version mismatch. Force that here.
const renderThrows = new Error(
  "Cannot read properties of undefined (reading 'S')",
);
vi.mock('ink', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ink')>()),
  render: () => {
    throw renderThrows;
  },
}));
vi.mock('../../../utils/analytics.js', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../../../utils/debug.js', () => ({
  logToFile: vi.fn(),
}));

const LEAVE_ALT_SCREEN = '\x1b[?1049l';
const ENTER_ALT_SCREEN = '\x1b[?1049h';

describe('startTUI', () => {
  it('leaves the alt screen before a render() crash propagates', () => {
    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      expect(() => startTUI('1.0.0', Program.PostHogIntegration)).toThrow(
        renderThrows,
      );
    } finally {
      process.stdout.write = originalWrite;
    }

    const output = chunks.join('');
    // The alt screen was entered, then left — so the caller's error message
    // lands in the restored main buffer instead of a discarded one.
    expect(output).toContain(ENTER_ALT_SCREEN);
    expect(output).toContain(LEAVE_ALT_SCREEN);
    expect(output.lastIndexOf(LEAVE_ALT_SCREEN)).toBeGreaterThan(
      output.indexOf(ENTER_ALT_SCREEN),
    );
  });
});
