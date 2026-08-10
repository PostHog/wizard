import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  clearCleanup,
  registerCleanup,
  runCleanups,
} from '@utils/wizard-abort';
import { wipeOrchestratorCache } from '@lib/agent/runner/sequence/orchestrator/cache-cleanup';
import {
  QueueStore,
  QUEUE_DIR_NAME,
} from '@lib/agent/runner/sequence/orchestrator/queue';

vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn(), wizardCapture: vi.fn() },
}));

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-cache-'));
}

describe('wipeOrchestratorCache', () => {
  let dir: string;

  beforeEach(() => {
    clearCleanup();
    dir = tmpDir();
  });

  afterEach(() => {
    clearCleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('removes the cache directory created by QueueStore', () => {
    new QueueStore(dir, 'run-1');
    const cachePath = path.join(dir, QUEUE_DIR_NAME);
    expect(fs.existsSync(cachePath)).toBe(true);

    wipeOrchestratorCache(dir);

    expect(fs.existsSync(cachePath)).toBe(false);
  });

  it('is a no-op when the cache directory is already gone', () => {
    expect(() => wipeOrchestratorCache(dir)).not.toThrow();
  });

  it('removes the cache when run via registerCleanup (abort path)', () => {
    new QueueStore(dir, 'run-1');
    const cachePath = path.join(dir, QUEUE_DIR_NAME);
    expect(fs.existsSync(cachePath)).toBe(true);

    registerCleanup(() => wipeOrchestratorCache(dir));
    runCleanups();

    expect(fs.existsSync(cachePath)).toBe(false);
  });
});
