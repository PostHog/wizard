/**
 * Shared preparation for the runner pipeline.
 *
 * Runs before the fork into the linear or orchestrator arm: logging targets,
 * the gateway mint and the scan-triage classifier built on it. Everything the
 * caller must decide first — health gates, settings conflicts, authentication,
 * the AI opt-in gate, post-auth gates, feature flags, run tags, token refresh —
 * arrives already resolved in `RunConfig` and `RunInput`.
 */

import { createTriageLLMProvider } from '@agent/triage-provider';
import { gatewayAuth } from '@agent/gateway-session';
import { logToFile } from '@utils/debug';
import { CallType, IS_DEV } from '@shared/constants';
import { VERSION } from '@shared/version';
import { mcpUrlFor } from '@shared/host-resolution';
import type { WizardRunOptions } from '@utils/types';
import type { BootstrapResult, RunConfig, RunFlags, RunInput } from './types';

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Decide whether the `wizard_ask` overlay should be wired for this run.
 * Disabled in non-interactive modes (CI, signup) — there's no human to
 * answer. Per-program disabling is done by adding WIZARD_ASK_TOOL_NAME to
 * the program's `disallowedTools` so the SDK rejects calls outright.
 * Extracted so the policy can be unit-tested directly.
 *
 * `e2eAsk` is the one escape hatch. The e2e harness runs a `ci`
 * session, but it does have an answerer — the driver loop answers each
 * `wizard_ask` batch from the program's e2e profile. Without the flag the
 * agent-in-the-loop layer (the ask bridge in both sequence arms, and the
 * orchestrator's seeded warehouse task) stays unreachable from a test.
 *
 * Only the e2e TUI host sets the flag, from the `E2E_ASK` env var. No CLI flag
 * populates it, so plain `--ci` and `--signup` runs behave exactly as before.
 */
export function shouldDisableAsk(
  flags: Pick<RunFlags, 'ci' | 'signup' | 'e2eAsk'>,
): boolean {
  return (flags.ci || flags.signup) && !flags.e2eAsk;
}

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
 * Shared setup for both arms: logging targets, then the gateway mint and the
 * triage classifier. Throws when the mint is refused, so the run fails before
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

  // Mint now so a refusal fails the boot before any agent starts. Later
  // readers re-resolve through the cache, which re-mints past the refresh
  // point.
  const currentGatewayAuth = () =>
    // TODO: the agent must not mint inference auth. It receives the
    // PostHog token here and derives a gateway token from it, re-minting near
    // expiry. Programs own credentials (stack plan 4.5): pass a resolved
    // inference-auth provider on RunInput.credentials and move
    // gateway-session.ts out of src/agent with it.
    gatewayAuth(credentials.host, credentials.accessToken, programId);
  await currentGatewayAuth();

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
      const auth = await currentGatewayAuth();
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
