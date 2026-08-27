import { ErrorCodes, type ErrorCode } from './codes';

export interface AuthFailureInput {
  hasSettingsConflict?: boolean;
  usingManagedLogin?: boolean;
  apiKey?: string;
  missingScopes?: readonly string[];
  gatewayRegion?: 'us' | 'eu' | 'local';
  sessionRegion?: 'us' | 'eu';
}

export function classifyAuthFailure(input: AuthFailureInput): ErrorCode {
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
