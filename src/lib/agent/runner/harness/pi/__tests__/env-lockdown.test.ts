/**
 * Env lockdown: pi's tool subprocesses must never see a secret or an ambient
 * variable. These pin that the scrub keeps only the operational allowlist and
 * drops everything else — the leak that exposed the test key before.
 */

import { buildScrubbedEnv } from '..';

describe('buildScrubbedEnv', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  it('drops secrets and ambient credentials', () => {
    process.env.POSTHOG_PERSONAL_API_KEY = 'phx_secret';
    process.env.ANTHROPIC_AUTH_TOKEN = 'tok';
    process.env.AWS_SECRET_ACCESS_KEY = 'aws';
    process.env.SOME_RANDOM_AMBIENT_VAR = 'x';

    const env = buildScrubbedEnv();

    expect(env.POSTHOG_PERSONAL_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.SOME_RANDOM_AMBIENT_VAR).toBeUndefined();
  });

  it('keeps the operational allowlist needed to run a package manager', () => {
    process.env.PATH = '/usr/bin';
    process.env.HOME = '/home/test';

    const env = buildScrubbedEnv();

    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/test');
  });

  it('omits allowlisted keys that are absent rather than setting them empty', () => {
    delete process.env.HTTPS_PROXY;
    const env = buildScrubbedEnv();
    expect('HTTPS_PROXY' in env).toBe(false);
  });
});
