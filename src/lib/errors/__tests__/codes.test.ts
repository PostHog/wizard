import { describe, expect, it } from 'vitest';
import { ErrorCodes, ERROR_CODE_PATTERN, isErrorCode } from '../codes';
import { ERROR_CATALOG } from '../catalog';

describe('error codes', () => {
  it('every code matches the PHW pattern', () => {
    for (const code of Object.values(ErrorCodes)) {
      expect(code).toMatch(ERROR_CODE_PATTERN);
    }
  });

  it('codes are unique', () => {
    const values = Object.values(ErrorCodes);
    expect(new Set(values).size).toBe(values.length);
  });

  it('isErrorCode accepts known codes and rejects unknown strings', () => {
    expect(isErrorCode(ErrorCodes.InternalUnhandled)).toBe(true);
    expect(isErrorCode('NOT_A_CODE')).toBe(false);
    expect(isErrorCode('phw_internal_unhandled')).toBe(false);
  });
});

describe('error catalog', () => {
  it('has an entry for every error code', () => {
    for (const code of Object.values(ErrorCodes)) {
      expect(
        ERROR_CATALOG[code],
        `missing catalog entry for ${code}`,
      ).toBeDefined();
    }
  });

  it('catalog contains no extra entries', () => {
    const codeValues = new Set(Object.values(ErrorCodes));
    for (const key of Object.keys(ERROR_CATALOG)) {
      expect(
        codeValues.has(key as (typeof ErrorCodes)[keyof typeof ErrorCodes]),
        `orphan catalog entry ${key}`,
      ).toBe(true);
    }
  });

  it('every entry carries a group, retry advice, and a description', () => {
    for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
      expect(entry.group, `${code} group`).toBeTruthy();
      expect(['yes', 'no', 'case-by-case'], `${code} retry`).toContain(
        entry.retry,
      );
      expect(entry.description.length, `${code} description`).toBeGreaterThan(
        5,
      );
    }
  });
});
