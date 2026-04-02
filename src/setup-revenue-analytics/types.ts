/**
 * Shared types for the setup-revenue-analytics command.
 */

export type Language =
  | 'node'
  | 'python'
  | 'ruby'
  | 'php'
  | 'go'
  | 'java'
  | 'dotnet';

export interface StripeCallLocation {
  file: string;
  line: number;
  snippet: string;
}

export interface StripeChargeCall extends StripeCallLocation {
  type: 'payment_intent' | 'subscription' | 'checkout_session' | 'invoice';
}

export interface StripeDetectionResult {
  sdkPackage: string;
  sdkVersion: string | null;
  language: Language;
  customerCreationCalls: StripeCallLocation[];
  chargeCalls: StripeChargeCall[];
  usesCheckoutSessions: boolean;
}

export interface PostHogDistinctIdResult {
  distinctIdExpression: string | null;
  sourceFile: string | null;
  sourceLine: string | null;
}

export interface StripeDocsForLanguage {
  customerCreate: {
    pattern: string;
    metadataExample: string;
    fullExample: string;
  };
  customerUpdate: {
    pattern: string;
    metadataExample: string;
    fullExample: string;
  };
}
