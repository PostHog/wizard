export type ErrorGroup =
  | 'cli'
  | 'args'
  | 'auth'
  | 'env'
  | 'detect'
  | 'skill'
  | 'agent'
  | 'settings'
  | 'internal';

export type RetryAdvice = 'yes' | 'no' | 'case-by-case';

export interface ErrorCatalogEntry {
  group: ErrorGroup;
  retry: RetryAdvice;
  description: string;
}
