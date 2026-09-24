import { captureTui } from '../tui-capture';

const run = (script: string) =>
  captureTui({
    cmd: process.execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    env: process.env,
  }).exited;

describe('captureTui', () => {
  it('resolves exited with the child exit code', async () => {
    expect(await run('process.exit(0)')).toBe(0);
    expect(await run('process.exit(3)')).toBe(3);
  });

  it('resolves exited with 128 + signal when a signal ends the child', async () => {
    expect(await run("process.kill(process.pid, 'SIGTERM')")).toBe(143);
  });
});
