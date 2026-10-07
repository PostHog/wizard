import { printAbortOutro } from '@shared/console-log';
import { OutroKind } from '@shared/outro';
import { ErrorCodes, PHW_ERROR_PREFIX } from '@shared/errors';

it('prints an abort outro and its machine-readable line, and resolves at once', async () => {
  const printed: string[] = [];
  const stdout = vi
    .spyOn(console, 'log')
    .mockImplementation((line: string) => void printed.push(line));
  const stderr: string[] = [];
  const write = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk) => stderr.push(String(chunk)) > 0);
  try {
    const outro = { kind: OutroKind.Error, message: 'Services are down' };
    // No screen to dismiss: the abort's exit is never held up.
    await printAbortOutro(outro, {
      code: ErrorCodes.EnvServiceOutage,
      message: outro.message,
    });
    expect(printed.some((line) => line.includes('Services are down'))).toBe(
      true,
    );
    expect(stderr.join('')).toContain(
      `${PHW_ERROR_PREFIX} {"code":"${ErrorCodes.EnvServiceOutage}"`,
    );
  } finally {
    stdout.mockRestore();
    write.mockRestore();
  }
});
