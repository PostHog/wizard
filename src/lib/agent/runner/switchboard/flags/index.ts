/**
 * Switchboard flags, one module per experiment (basic-integration,
 * self-driving, orchestrator, …); `schemes.ts` owns the shared config shapes
 * and resolution. The switchboard only calls the resolvers exported here.
 */
import type { ProgramId } from '@lib/programs/program-registry';
import { BASIC_INTEGRATION_FLAGS } from './basic-integration';
import { SELF_DRIVING_FLAGS } from './self-driving';
import {
  routeFromConfigFlag,
  type ConfigFlag,
  type FlagRoute,
} from './schemes';

/** Programs whose pi routing is flag-driven; absent → the flags are a no-op. */
export const FLAG_CONFIGS: Partial<Record<ProgramId, ConfigFlag>> = {
  'posthog-integration': BASIC_INTEGRATION_FLAGS,
  'self-driving': SELF_DRIVING_FLAGS,
};

/** The flag-driven pi route for a program, or undefined when its flags don't validly route it. */
export function resolveFlagRoute(
  program: ProgramId,
  flags: Record<string, string>,
  flagPayloads?: Record<string, unknown>,
): FlagRoute | undefined {
  const cfg = FLAG_CONFIGS[program];
  return cfg && routeFromConfigFlag(cfg, flags, flagPayloads);
}

export { isOrchestratorEnabled } from './orchestrator';
export type { ConfigFlag, FlagRoute } from './schemes';
