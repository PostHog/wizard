import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CursorMCPClient } from '@shared/mcp-clients/clients/cursor';
import { VisualStudioCodeClient } from '@shared/mcp-clients/clients/visual-studio-code';
import { ZedClient } from '@shared/mcp-clients/clients/zed';

vi.mock('os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('os')>()),
  homedir: vi.fn(),
}));

const originalPlatform = process.platform;
const setPlatform = (platform: NodeJS.Platform) =>
  Object.defineProperty(process, 'platform', { value: platform });

// Each client's config folder, relative to the home dir, on macOS.
const CASES = [
  { name: 'Cursor', client: () => new CursorMCPClient(), dir: ['.cursor'] },
  {
    name: 'VS Code',
    client: () => new VisualStudioCodeClient(),
    dir: ['Library', 'Application Support', 'Code', 'User'],
  },
  { name: 'Zed', client: () => new ZedClient(), dir: ['.config', 'zed'] },
];

describe.each(CASES)('$name install detection', ({ client, dir }) => {
  let home: string;

  beforeEach(() => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-')));
    vi.mocked(os.homedir).mockReturnValue(home);
    vi.stubEnv('XDG_CONFIG_HOME', '');
    setPlatform('darwin');
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('is not installed when its config folder is missing', async () => {
    await expect(client().isClientSupported()).resolves.toBe(false);
  });

  it('is installed once its config folder exists', async () => {
    fs.mkdirSync(path.join(home, ...dir), { recursive: true });
    await expect(client().isClientSupported()).resolves.toBe(true);
  });

  it('is not installed on an unsupported platform', async () => {
    fs.mkdirSync(path.join(home, ...dir), { recursive: true });
    setPlatform('aix');
    await expect(client().isClientSupported()).resolves.toBe(false);
  });
});
