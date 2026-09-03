import { describe, expect, it } from 'vitest';
import {
  formatModuleMissingMessage,
  isModuleNotFoundError,
} from '../module-missing';

describe('isModuleNotFoundError', () => {
  it('recognises the Node error code', () => {
    const err = Object.assign(new Error('boom'), {
      code: 'ERR_MODULE_NOT_FOUND',
    });
    expect(isModuleNotFoundError(err)).toBe(true);
  });

  // A dynamic import rethrown across a boundary keeps the text, not the code.
  it('recognises the message alone', () => {
    expect(
      isModuleNotFoundError(
        new Error(
          "Cannot find package '/Users/a/.npm/_npx/9f2/node_modules/chalk/index.js'",
        ),
      ),
    ).toBe(true);
  });

  it('leaves an ordinary API failure alone', () => {
    expect(isModuleNotFoundError(new Error('502 Bad Gateway'))).toBe(false);
  });

  // An npx cache hash is 16 hex characters, so it can contain "429" — which the
  // harness's rate-limit substring test would otherwise claim first.
  it('recognises a cache hash that looks like a rate limit', () => {
    expect(
      isModuleNotFoundError(
        new Error(
          "Cannot find package '/Users/a/.npm/_npx/429abc0d15e7f318/node_modules/chalk/index.js'",
        ),
      ),
    ).toBe(true);
  });
});

describe('formatModuleMissingMessage', () => {
  it('names the exact download to delete', () => {
    const message = formatModuleMissingMessage(
      "Cannot find package '/Users/a/.npm/_npx/9f2/node_modules/chalk/index.js'",
    );
    expect(message).toContain('rm -rf "/Users/a/.npm/_npx/9f2"');
  });

  // A Windows profile is routinely `C:\Users\John Smith`, and a POSIX home can
  // hold a space too. Capturing from the last space left a relative path, and
  // `rm -rf` on a relative path matches nothing and exits 0 — the user believes
  // the cache is clear, reruns, and hits the identical failure.
  it('keeps a POSIX cache path that contains a space whole', () => {
    expect(
      formatModuleMissingMessage(
        "Cannot find package 'chalk' imported from /Users/First Last/.npm/_npx/9f2abc1234567890/node_modules/pi/dist/index.js",
      ),
    ).toContain('rm -rf "/Users/First Last/.npm/_npx/9f2abc1234567890"');
  });

  it('keeps a Windows cache path that contains a space whole', () => {
    expect(
      formatModuleMissingMessage(
        "Cannot find package 'chalk' imported from C:\\Users\\John Smith\\AppData\\Local\\npm-cache\\_npx\\abc1234567890def\\node_modules\\x.js",
      ),
    ).toContain(
      'rm -rf "C:\\Users\\John Smith\\AppData\\Local\\npm-cache\\_npx\\abc1234567890def"',
    );
  });

  // Half a path is worse than none, so a fragment with no root is not printed.
  it('falls back rather than naming a path it cannot root', () => {
    const message = formatModuleMissingMessage(
      "Cannot find module 'foo/_npx/9f2/node_modules/x'",
    );
    expect(message).not.toContain('rm -rf "foo/_npx/9f2"');
    expect(message).toMatch(/rm -rf "\/[^"]*_npx"/);
  });

  // Every wizard command reaches this message, so it must not name one.
  it('asks for the same command again rather than the default flow', () => {
    const message = formatModuleMissingMessage('Cannot find module x');
    expect(message).toContain('run the same wizard command again');
    expect(message).not.toContain('npx @posthog/wizard@latest');
  });

  it('falls back to the whole npx cache', () => {
    expect(formatModuleMissingMessage('Cannot find module x')).toContain(
      '_npx',
    );
  });
});
