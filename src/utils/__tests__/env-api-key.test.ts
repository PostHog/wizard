import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { readApiKeyFromEnv } from '@utils/env-api-key';

describe('readApiKeyFromEnv', () => {
  let tmpDir: string;
  let cwdSpy: jest.SpyInstance;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'wizard-env-test-'));
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns undefined when no env file exists', () => {
    expect(readApiKeyFromEnv()).toBeUndefined();
  });

  it('reads the key from .env', () => {
    writeFileSync(
      path.join(tmpDir, '.env'),
      'POSTHOG_PERSONAL_API_KEY=phx_from_env\n',
    );
    expect(readApiKeyFromEnv()).toBe('phx_from_env');
  });

  it('prefers .env.local over .env', () => {
    writeFileSync(
      path.join(tmpDir, '.env'),
      'POSTHOG_PERSONAL_API_KEY=phx_from_env\n',
    );
    writeFileSync(
      path.join(tmpDir, '.env.local'),
      'POSTHOG_PERSONAL_API_KEY=phx_from_local\n',
    );
    expect(readApiKeyFromEnv()).toBe('phx_from_local');
  });

  it('does not crash when .env is a directory (e.g. a Python virtualenv)', () => {
    mkdirSync(path.join(tmpDir, '.env'));
    expect(() => readApiKeyFromEnv()).not.toThrow();
    expect(readApiKeyFromEnv()).toBeUndefined();
  });

  it('falls back to .env when .env.local is a directory', () => {
    mkdirSync(path.join(tmpDir, '.env.local'));
    writeFileSync(
      path.join(tmpDir, '.env'),
      'POSTHOG_PERSONAL_API_KEY=phx_from_env\n',
    );
    expect(readApiKeyFromEnv()).toBe('phx_from_env');
  });
});
