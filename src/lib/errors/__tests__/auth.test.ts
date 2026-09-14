import { describe, expect, it } from 'vitest';
import { classifyAuthFailure } from '../auth';
import { ErrorCodes } from '../codes';

describe('classifyAuthFailure', () => {
  it('falls back to invalid-or-expired when nothing is known', () => {
    expect(classifyAuthFailure({})).toBe(ErrorCodes.AuthInvalidOrExpired);
  });

  // The one branch backed by a server verdict, so it has to beat every guess.
  it('reports a dead grant ahead of any inferred cause', () => {
    expect(classifyAuthFailure({ sessionExpired: true })).toBe(
      ErrorCodes.AuthSessionExpired,
    );
    expect(
      classifyAuthFailure({
        sessionExpired: true,
        usingManagedLogin: true,
        hasSettingsConflict: true,
        apiKey: 'phc_project_key',
        missingScopes: ['llm_gateway:read'],
        gatewayRegion: 'us',
        sessionRegion: 'eu',
      }),
    ).toBe(ErrorCodes.AuthSessionExpired);
  });

  it('leaves the existing precedence intact when the grant is fine', () => {
    expect(classifyAuthFailure({ usingManagedLogin: true })).toBe(
      ErrorCodes.AuthStoredLoginConflict,
    );
    expect(classifyAuthFailure({ hasSettingsConflict: true })).toBe(
      ErrorCodes.AuthSettingsConflict,
    );
    expect(classifyAuthFailure({ apiKey: 'phc_project_key' })).toBe(
      ErrorCodes.AuthKeyType,
    );
    expect(classifyAuthFailure({ missingScopes: ['llm_gateway:read'] })).toBe(
      ErrorCodes.AuthMissingScope,
    );
    expect(
      classifyAuthFailure({ gatewayRegion: 'us', sessionRegion: 'eu' }),
    ).toBe(ErrorCodes.AuthRegionMismatch);
  });

  it('does not treat sessionExpired: false as a signal', () => {
    expect(classifyAuthFailure({ sessionExpired: false })).toBe(
      ErrorCodes.AuthInvalidOrExpired,
    );
  });
});
