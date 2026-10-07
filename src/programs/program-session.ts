/**
 * ProgramSession: what a program reads about the run it is part of. The shared
 * `WizardSession` extends it with the launch values and run state.
 */

import type { Harness, Integration } from '@shared/constants';
import type { ApiUser, Credentials } from '@shared/api';
import type { DiscoveredFeature } from '@shared/discovered-feature';
import type { ScanConsent } from '@shared/run-state';
import type { FrameworkConfig } from './framework-config';
import type { OutroData } from '@agent/types';

export interface ProgramSession {
  /**
   * Harness-only escape hatch: keep the `wizard_ask` bridge wired in a `ci`
   * session so an e2e run can answer the agent's questions.
   *
   * Only the e2e TUI host sets it, from the `E2E_ASK` env var. There is no CLI
   * flag, `bin.ts` never populates it, and nothing in a published build reads
   * the env var — so a normal `--ci` run is unchanged. See `shouldDisableAsk`.
   *
   * Guarding `E2E_ASK` is not enough on its own: the CI runner spreads the
   * whole `POSTHOG_WIZARD_*` bag into `buildSession`, which would let
   * `POSTHOG_WIZARD_e2e_ask=true` set this field. `readEnvironment` drops it —
   * see `NEVER_FROM_ENV`, and keep that list in step with this comment.
   */
  e2eAsk: boolean;
  outroData: OutroData | null;
  // From CLI args
  debug: boolean;
  installDir: string;
  ci: boolean;
  signup: boolean;
  apiKey?: string;
  benchmark: boolean;
  yaraReport: boolean;
  /**
   * `--local-posthog` folds into `baseUrl`, and `--local-context-mill` is read
   * from `getLocalDev()` — neither belongs here. This one stays because
   * `mcp add|remove|tutorial --local` populate it from their own flag.
   */
  localMcp: boolean;
  /** `--harness` override, read by `resolveHarness`. Wins over the runner flag. */
  harness?: Harness;
  projectId?: number;
  /**
   * Gates reporting only; local detection runs either way. Reporting treats
   * 'undecided' as 'declined', so a path that reports before the user was
   * asked sends nothing rather than everything.
   */
  scanConsent: ScanConsent;
  /** Guards against reporting twice; consent resolves from two paths. */
  warehouseSourcesReported: boolean;
  /** Guards the AI SDK org stamp: `runProgram` makes it once, after the first login. */
  aiSdkStampReported: boolean;
  integration: Integration | null;
  frameworkContext: Record<string, unknown>;
  typescript: boolean;

  /** Human-readable label for the detected framework variant (e.g., "Django with Wagtail CMS") */
  detectedFrameworkLabel: string | null;

  /** PostHog found in the project's dependencies. A signal, not a verified install. */
  posthogSdkDetected: boolean;

  // From OAuth
  credentials: Credentials | null;

  /**
   * Full user payload from `/api/users/@me/` — identifiers, profile,
   * current team + organization, preferences, etc. Null until OAuth /
   * CI-key auth populates it. Schema lives in `src/shared/api.ts` and
   * passes through unknown upstream fields so downstream features can
   * read account context (plan, org name, email, etc.) without
   * re-fetching.
   */
  apiUser: ApiUser | null;

  // Feature discovery
  discoveredFeatures: DiscoveredFeature[];
  dashboardUrl: string | null;
  notebookUrl: string | null;
  skillId: string | null;

  // Resolved framework config (set after integration is known)
  frameworkConfig: FrameworkConfig | null;
}
