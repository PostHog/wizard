/**
 * Shared preparation for the runner pipeline.
 *
 * Runs before the fork into the linear or orchestrator arm: logging targets,
 * caller-owned gateway auth and the scan-triage classifier built on it. Everything the
 * caller must decide first — health gates, settings conflicts, authentication,
 * the AI opt-in gate, post-auth gates, feature flags, run tags, token refresh —
 * arrives already resolved in `RunConfig` and `RunInput`.
 */

import { createTriageLLMProvider } from '@agent/triage-provider';
import { logToFile } from '@utils/debug';
import { CallType, IS_DEV } from '@shared/constants';
import { VERSION } from '@shared/version';
import { mcpUrlFor } from '@shared/host-resolution';
import type { WizardRunOptions } from '@utils/types';
import type { BootstrapResult, RunConfig, RunInput } from './types';

// ── Helpers ──────────────────────────────────────────────────────────

/** The option bag the agent interface and the middleware read. */
export function runOptions(input: RunInput): WizardRunOptions {
  return {
    installDir: input.installDir,
    debug: input.flags.debug,
    signup: input.flags.signup,
    ci: input.flags.ci,
    benchmark: input.flags.benchmark,
    projectId: input.host.projectId,
    apiKey: input.host.apiKey,
    yaraReport: input.flags.yaraReport,
  };
}

// ── Prepare ───────────────────────────────────────────────────────────

/**
 * Shared setup for both arms: logging targets, then the supplied gateway auth and
 * triage classifier. Throws when auth is refused, so the run fails before
 * any agent starts — the caller maps that the way it maps any unexpected error.
 */
export async function prepareRun(
  config: RunConfig,
  input: RunInput,
): Promise<BootstrapResult> {
  const { skillsBaseUrl } = config;

  // Where this run actually points. The three services switch independently,
  // so otherwise "why did it use prod skills?" means reading three call sites.
  logToFile(
    `[agent-runner] targets build=${VERSION}${IS_DEV ? '/dev' : ''} ` +
      `skills=${skillsBaseUrl} ` +
      `mcp=${mcpUrlFor(input.flags.localMcp)} ` +
      `posthog=${input.host.baseUrl ?? 'region-resolved'}`,
  );

  const { credentials } = input;
  const { wizardFlags, wizardFlagPayloads, wizardMetadata, programId } = config;

  // Resolve before starting either sequence, so a refusal stops the run.
  const { inferenceAuth } = input;
  await inferenceAuth.resolve();

  return {
    skillsBaseUrl,
    credentials,
    // Carried so per-task sessions re-resolve against the same program the boot
    // minted for, rather than digging it back out of the metadata bag.
    programId,
    wizardFlags,
    wizardFlagPayloads,
    wizardMetadata,
    project: input.project,
    // Resolved once, here: the only place holding both the run-level harness
    // and the gateway auth. Every skill install downstream reads it off boot.
    triageProvider: createTriageLLMProvider(async () => {
      const auth = await inferenceAuth.resolve();
      return {
        baseURL: auth.gatewayUrl,
        authToken: auth.token,
        teamId: auth.teamId,
        // `call_type` splits scan spend out of the program's agent cost,
        // the same tag the in-run triage provider carries.
        wizardMetadata: { ...wizardMetadata, call_type: CallType.yaraTriage },
        wizardFlags,
      };
    }, config.binding.harness),
  };
}
