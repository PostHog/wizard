import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ControlClient } from '@host/control';
import { getProgramConfig } from '@programs';
import { runNonInteractive } from '../runners/run-non-interactive';

vi.mock(import('@utils/analytics'), () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
    shutdown: vi.fn(),
  } as never,
  sessionProperties: () => ({}),
}));

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function waitForSocket(socketPath: string): Promise<void> {
  await vi.waitFor(() => expect(fs.existsSync(socketPath)).toBe(true), {
    timeout: 10_000,
    interval: 50,
  });
}

describe('controlled headless run', () => {
  it('serves an idle store: parent calls before the first run are not refused as in flight', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'controlled-headless-'));
    dirs.push(dir);
    const socketPath = path.join(dir, 'control.sock');
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    // CI reads its gateway token from this file before serving.
    const tokenFile = path.join(dir, 'gateway-token');
    fs.writeFileSync(tokenFile, 'test-token');
    process.env.WIZARD_CI_GATEWAY_TOKEN_FILE = tokenFile;

    runNonInteractive(
      getProgramConfig('posthog-integration'),
      {
        installDir: dir,
        apiKey: 'phx_test',
        projectId: '1',
        region: 'us',
        controlSocket: socketPath,
        taskStreamLog: path.join(dir, 'stream.jsonl'),
      },
      'ci',
    );
    await waitForSocket(socketPath);

    const client = new ControlClient(socketPath);
    const state = await client.state();
    expect(state.session.runPhase).toBe('idle');
    expect(await client.runs()).toEqual([]);
    // Idle-gated route: answered 409 while the store claimed a run was in flight.
    await expect(client.shutdown()).resolves.toBeUndefined();
  });
});
