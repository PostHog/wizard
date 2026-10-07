import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readApiKeyFromEnv } from '@utils/env-api-key';

describe('readApiKeyFromEnv', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-api-key-'));
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads the key from .env', () => {
    fs.writeFileSync(
      path.join(dir, '.env'),
      'POSTHOG_PERSONAL_API_KEY=phx_1\n',
    );
    expect(readApiKeyFromEnv()).toBe('phx_1');
  });

  it('returns undefined when .env is a directory', () => {
    fs.mkdirSync(path.join(dir, '.env'));
    expect(readApiKeyFromEnv()).toBeUndefined();
  });
});
