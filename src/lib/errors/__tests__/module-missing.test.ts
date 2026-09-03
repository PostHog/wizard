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
