/**
 * Pins the env contract all three surface e2e routes share, so a route never
 * starts a live run with an input the others would reject.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readE2eEnv, readPersonalApiKey } from '../surface-e2e';

const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-e2e-'));
const complete = {
  APP_DIR: appDir,
  POSTHOG_PERSONAL_API_KEY: 'phx_inline',
  PROJECT_ID: '228144',
  WIZARD_CI_GATEWAY_TOKEN_FILE: '/tokens/gateway',
};

it('prefers the inline key and falls back to the key file when it is blank', () => {
  const readFile = vi.fn().mockReturnValue(' phx_file \n');
  expect(readPersonalApiKey(complete, readFile)).toBe('phx_inline');
  expect(
    readPersonalApiKey(
      { POSTHOG_PERSONAL_API_KEY: '  ', POSTHOG_KEY_FILE: '/keys/phx' },
      readFile,
    ),
  ).toBe('phx_file');
  expect(readFile).toHaveBeenCalledWith('/keys/phx');
});

it('reads a complete env', () => {
  expect(readE2eEnv(complete)).toEqual({
    appDir,
    apiKey: 'phx_inline',
    projectId: 228144,
    gatewayTokenFile: '/tokens/gateway',
  });
});

it('lets the agent route run without an app directory', () => {
  expect(
    readE2eEnv({ ...complete, APP_DIR: '' }, { needsAppDir: false }).appDir,
  ).toBe('');
});

it.each([
  ['APP_DIR', { APP_DIR: path.join(appDir, 'missing') }],
  ['POSTHOG_PERSONAL_API_KEY', { POSTHOG_PERSONAL_API_KEY: '' }],
  ['PROJECT_ID', { PROJECT_ID: '0' }],
  ['WIZARD_CI_GATEWAY_TOKEN_FILE', { WIZARD_CI_GATEWAY_TOKEN_FILE: ' ' }],
])('names a missing %s', (name, override) => {
  expect(() => readE2eEnv({ ...complete, ...override })).toThrow(name);
});
