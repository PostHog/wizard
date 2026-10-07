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
  it('files the mint codes under the gateway group', () => {
    // A refusal is a per-run decision the user can sometimes act on; a failure
    // is the mint being unavailable and clears on its own.
    expect(ERROR_CATALOG[ErrorCodes.GatewayMintRefused]).toMatchObject({
      group: 'gateway',
      retry: 'case-by-case',
    });
    expect(ERROR_CATALOG[ErrorCodes.GatewayMintFailed]).toMatchObject({
      group: 'gateway',
      retry: 'yes',
    });
  });
});
