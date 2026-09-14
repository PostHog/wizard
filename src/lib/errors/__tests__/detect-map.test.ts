import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../codes';
import { ERROR_CATALOG } from '../catalog';
import { detectErrorCode, type DetectErrorKind } from '../detect-map';

/**
 * Every kind the programs can emit. `DetectErrorKind` is derived from their
 * unions, so the annotation below is the real guard: adding a kind to a
 * program's `DetectError` without listing it here fails to type-check.
 */
const ALL_KINDS: readonly DetectErrorKind[] = [
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
  it('maps every detect kind to a detect-group code', () => {
    for (const kind of ALL_KINDS) {
      const code = detectErrorCode(kind);
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

  it('resolves no kind to the internal catch-all', () => {
    for (const kind of ALL_KINDS) {
      expect(detectErrorCode(kind), kind).not.toBe(
        ErrorCodes.InternalUnhandled,
      );
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
