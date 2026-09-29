/**
 * WizardSession — the launch values and run state every host shares.
 *
 * A host fills the launch values from its arguments; detection, the login and
 * the run fill the rest, written through a `SessionStore`. The TUI keeps its
 * screens' own state in its store, beside the session; headless and embedders
 * have none.
 */

import { POSTHOG_LOCAL_URL, resolveLocalDev } from '@shared/local-dev';
import type { Harness, Integration, Sequence } from '@shared/constants';
import type { WizardReadinessResult } from '@shared/health-checks/readiness';
import type { ApiProject, GatewayCredential } from '@shared/api';
import type { CloudRegion } from '@utils/types';
import type {
  PendingQuestion,
  ResolvedBinding,
  TaskNotice,
} from '@agent/types';
import { RunPhase, ScanConsent } from '@shared/run-state';
import type { ProgramSession } from '../program-session';

function parseProjectIdArg(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export interface WizardSession extends ProgramSession {
  /** A pre-issued gateway token a dev or test `--ci` run logs in with; the login puts it on the credentials. */
  ciGateway: GatewayCredential | null;
  /**
   * `--local-posthog` folds into `baseUrl`, and `--local-context-mill` is read
   * from `getLocalDev()` — neither belongs here. This one stays because
   * `mcp add|remove|tutorial --local` populate it from their own flag.
   */
  localMcp: boolean;
  email?: string;
  region?: CloudRegion;
  /**
   * Explicit PostHog base URL (`--base-url`). When set, it pins every PostHog
   * origin — API host, cloud/app URL, OAuth server — and `region` is ignored.
   * Empty/unset → region-based resolution.
   */
  baseUrl?: string;
  noTelemetry: boolean;
  /**
   * `--capture-aio`: mirror every wizard LLM call as an `$ai_generation` event
   * into the authenticated project's AI Observability tab. Dev/test builds only.
   */
  captureAio: boolean;
  /** `--harness` override. Wins over the runner flag. */
  harness?: Harness;
  /** `--sequence` override. Wins over the orchestrator flag. */
  sequence?: Sequence;
  /** `--model` override (gateway id). Wins over the binding's model. */
  model?: string;

  /** True once framework detection has run (whether it found something or not). */
  detectionComplete: boolean;
  /** Set when the detected framework version is too old for the wizard. */
  unsupportedVersion: {
    current: string;
    minimum: string;
    docsUrl: string;
  } | null;
  /** `role_at_organization` from `/api/users/@me/`; null when unknown. */
  roleAtOrganization: string | null;
  /**
   * Project payload resolved at login, kept so a second agent run in the same
   * invocation reuses the first login instead of logging in again.
   */
  apiProject: ApiProject | null;
  runPhase: RunPhase;
  /** The sequence, harness, model and effort the last agent run resolved. */
  binding: ResolvedBinding | null;
  /** The service health check, once run: by the TUI's health screen, or by `runProgram`. */
  readinessResult: WizardReadinessResult | null;
  /** The optional step's notice waiting on an answer. */
  taskNotice: TaskNotice | null;
  /** The agent's open wizard_ask request. */
  pendingQuestion: PendingQuestion | null;
}

/** The launch values a host builds a session from. */
export type SessionArgs = {
  debug?: boolean;
  installDir?: string;
  ci?: boolean;
  signup?: boolean;
  /** Harness-only. Set by the e2e TUI host from `E2E_ASK`, never by a flag. */
  e2eAsk?: boolean;
  localDev?: boolean;
  localMcp?: boolean;
  localPosthog?: boolean;
  apiKey?: string;
  email?: string;
  region?: CloudRegion;
  baseUrl?: string;
  integration?: Integration;
  benchmark?: boolean;
  yaraReport?: boolean;
  projectId?: string;
  noTelemetry?: boolean;
  harness?: Harness;
  sequence?: Sequence;
  model?: string;
  captureAio?: boolean;
};

/** Build a WizardSession from launch values, pre-populating whatever is known. */
export function buildSession(args: SessionArgs): WizardSession {
  const local = resolveLocalDev(args);
  return {
    debug: args.debug ?? false,
    installDir: args.installDir ?? process.cwd(),
    ci: args.ci ?? false,
    signup: args.signup ?? false,
    e2eAsk: args.e2eAsk ?? false,
    ciGateway: null,
    localMcp: local.localMcp,
    apiKey: args.apiKey,
    email: args.email,
    region: args.region,
    // `--local-posthog` is sugar over `--base-url`, which every downstream URL
    // helper already honours. An explicit `--base-url` is more specific, so it wins.
    baseUrl:
      args.baseUrl ?? (local.localPosthog ? POSTHOG_LOCAL_URL : undefined),
    benchmark: args.benchmark ?? false,
    yaraReport: args.yaraReport ?? false,
    projectId: parseProjectIdArg(args.projectId),
    noTelemetry: args.noTelemetry ?? false,
    captureAio: args.captureAio ?? false,
    harness: args.harness,
    sequence: args.sequence,
    model: args.model,
    // No screen can ask in a scripted CI run, so granting keeps CI's telemetry
    // as it was. A headless `--ci --signup` run stays covered by the ci branch.
    scanConsent: args.ci ? ScanConsent.Granted : ScanConsent.Undecided,
    warehouseSourcesReported: false,
    aiSdkStampReported: false,
    integration: args.integration ?? null,
    frameworkContext: {},
    typescript: false,
    detectedFrameworkLabel: null,
    posthogSdkDetected: false,
    detectionComplete: false,
    unsupportedVersion: null,
    runPhase: RunPhase.Idle,
    binding: null,
    discoveredFeatures: [],
    credentials: null,
    roleAtOrganization: null,
    apiUser: null,
    apiProject: null,
    readinessResult: null,
    taskNotice: null,
    outroData: null,
    dashboardUrl: null,
    notebookUrl: null,
    skillId: null,
    frameworkConfig: null,
    pendingQuestion: null,
  };
}
