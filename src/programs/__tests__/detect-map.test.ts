import { describe, expect, it } from 'vitest';
import { ErrorCodes, ERROR_CATALOG } from '@shared/errors';
import { detectErrorCode } from '../detect-map';
import { PROGRAM_REGISTRY } from '../program-registry';

/**
 * Every kind the programs emit today. Each program's `detectErrorCodes` is
 * typed against its own `DetectError` union, which is the compile-time guard;
 * this list catches a table that drops out of the registry.
 */
const ALL_KINDS: readonly string[] = [
  'bad-directory',
  'unsupported-platform',
  'no-project-files',
  'no-sources',
  'no-package-json',
  'no-sdks',
  'missing-stripe',
  'no-posthog-sdk',
  'no-posthog',
  'missing-posthog',
];

describe('detectErrorCode', () => {
  it("resolves each program's kinds to that program's own code", () => {
    // Kinds are looked up by name alone, so two programs that share a kind
    // must agree on its code.
    for (const config of PROGRAM_REGISTRY) {
      for (const [kind, code] of Object.entries(
        config.detectErrorCodes ?? {},
      )) {
        expect(detectErrorCode(kind), `${config.id} ${kind}`).toBe(code);
      }
    }
  });

  it('maps every detect kind to a detect-group code', () => {
    for (const kind of ALL_KINDS) {
      const code = detectErrorCode(kind);
      expect(code, kind).not.toBe(ErrorCodes.DetectUnclassified);
      expect(ERROR_CATALOG[code].group, `${kind} group`).toBe('detect');
    }
  });

  it('never advises retrying a detect failure', () => {
    // The whole point of the code: a precondition failure is a property of the
    // user's project. A sandbox that retries one burns its budget for nothing.
    for (const kind of ALL_KINDS) {
      expect(ERROR_CATALOG[detectErrorCode(kind)].retry, kind).toBe('no');
    }
  });

  it('falls back to an unclassified detect code, not an internal one', () => {
    const code = detectErrorCode('a-kind-nobody-has-written-yet');
    expect(code).toBe(ErrorCodes.DetectUnclassified);
    expect(ERROR_CATALOG[code].retry).toBe('no');
  });

  it('folds the three "no PostHog SDK" kinds onto one code', () => {
    // Collapsing is deliberate — one failure class, one code. Hosts that need
    // to tell the programs apart read `detail.kind`, which the runner keeps.
    for (const kind of ['no-posthog-sdk', 'no-posthog', 'missing-posthog']) {
      expect(detectErrorCode(kind), kind).toBe(ErrorCodes.DetectNoPosthogSdk);
    }
  });
});
