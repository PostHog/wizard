import { ErrorCodes, type ErrorCode } from './codes';

export interface AuthFailureInput {
  hasSettingsConflict?: boolean;
  usingManagedLogin?: boolean;
  /** A pre-run token refresh already failed on a dead grant this run. */
  sessionExpired?: boolean;
  apiKey?: string;
  missingScopes?: readonly string[];
  gatewayRegion?: 'us' | 'eu' | 'local';
  sessionRegion?: 'us' | 'eu';
}

export function classifyAuthFailure(input: AuthFailureInput): ErrorCode {
  // First: the only branch backed by a server verdict rather than inference.
  // The token endpoint already told us the grant is dead, so every heuristic
  // below would be guessing at a cause we know.
  if (input.sessionExpired) return ErrorCodes.AuthSessionExpired;
  if (input.usingManagedLogin) return ErrorCodes.AuthStoredLoginConflict;
  if (input.hasSettingsConflict) return ErrorCodes.AuthSettingsConflict;
  if (
    input.apiKey &&
    !input.apiKey.startsWith('phx_') &&
    !input.apiKey.startsWith('pha_')
  ) {
    return ErrorCodes.AuthKeyType;
  }
  if (input.missingScopes && input.missingScopes.length > 0) {
    return ErrorCodes.AuthMissingScope;
  }
  if (
    input.gatewayRegion &&
    input.sessionRegion &&
    input.gatewayRegion !== 'local' &&
    input.gatewayRegion !== input.sessionRegion
  ) {
    return ErrorCodes.AuthRegionMismatch;
  }
  return ErrorCodes.AuthInvalidOrExpired;
}
