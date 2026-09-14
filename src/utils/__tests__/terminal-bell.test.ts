/**
 * The bell is the safeguard for the gap this change opens: consent is taken in
 * the first seconds of the run, and the credential questions arrive at the end
 * of it. It has to be audible to a person who stepped away, and invisible
 * everywhere a bell cannot ring.
 */
import { ringTerminalBell } from '@utils/terminal-bell';

const BEL = '\u0007';

describe('ringTerminalBell', () => {
  let write: ReturnType<typeof vi.spyOn>;
  const isTTY = process.stderr.isTTY;

  beforeEach(() => {
    write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    write.mockRestore();
    Object.defineProperty(process.stderr, 'isTTY', {
      value: isTTY,
      configurable: true,
    });
  });

  const setTTY = (value: boolean) =>
    Object.defineProperty(process.stderr, 'isTTY', {
      value,
      configurable: true,
    });

  it('writes one BEL to stderr on a TTY', () => {
    setTTY(true);
    ringTerminalBell();
    // stderr, not stdout: Ink owns stdout and repaints whole frames, so a byte
    // written there can land inside one.
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(BEL);
  });

  it('stays silent when stderr is not a TTY', () => {
    // A pipe or a CI log cannot ring; the byte would only pollute the capture.
    setTTY(false);
    ringTerminalBell();
    expect(write).not.toHaveBeenCalled();
  });

  it('never throws when the write fails', () => {
    // A bell is a nicety. It must not be the thing that ends a run.
    setTTY(true);
    write.mockImplementation(() => {
      throw new Error('EPIPE');
    });
    expect(() => ringTerminalBell()).not.toThrow();
  });
});
