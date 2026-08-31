import { PostHog } from 'posthog-node';
import {
  ANALYTICS_HOST_URL,
  ANALYTICS_POSTHOG_PUBLIC_PROJECT_WRITE_KEY,
  ANALYTICS_TEAM_TAG,
  WIZARD_FLAG_KEYS,
} from '@lib/constants';
import {
  reportableDiscoveredFeatures,
  type WizardSession,
} from '@lib/wizard-session';
import type { ApiUser } from '@lib/api';
import { v4 as uuidv4 } from 'uuid';
import { IS_PRODUCTION_BUILD, RUN_SURFACE, TASK_ID, TASK_RUN_ID } from '@env';
import { VERSION } from '@lib/version';
import { debug, logToFile } from './debug';
import { applyCiFlagOverrides } from './ci-flag-overrides';

/**
 * The invocation, reduced to flag-safe strings: the command word (first
 * positional, 'default' for the bare flow) and the sorted option NAMES.
 * Option values never leave the machine — they carry paths, emails, keys.
 */
function invocationProperties(): { command: string; cli_flags: string } {
  const args = process.argv.slice(2);
  const command = args.find((a) => !a.startsWith('-')) ?? 'default';
  const flags = [
    ...new Set(
      args
        .filter((a) => a.startsWith('--'))
        .map((a) => a.slice(2).split('=')[0]),
    ),
  ].sort();
  return { command, cli_flags: flags.join(',') };
}

/**
 * Extract a standard property bag from the current session.
 * Used by store-level analytics and available for ad-hoc captures.
 */
export function sessionProperties(
  session: WizardSession,
): Record<string, unknown> {
  // reportableDiscoveredFeatures() owns the consent decision; this file
  // never needs to know what `scanConsent` means, only that the result
  // might be absent. An absent key is unambiguous, while an empty array
  // would read as "we looked and found nothing" instead of "not reported".
  const discoveredFeatures = reportableDiscoveredFeatures(session);

  return {
    integration: session.integration,
    detected_framework: session.detectedFrameworkLabel,
    typescript: session.typescript,
    project_id: session.credentials?.projectId,
    ...(discoveredFeatures !== undefined
      ? { discovered_features: discoveredFeatures }
      : {}),
    scan_consent: session.scanConsent,
    additional_features: session.additionalFeatureQueue,
    run_phase: session.runPhase,
  };
}

export function groupsFromUser(
  user: ApiUser | null,
  host: string,
): Record<string, string> {
  const groups: Record<string, string> = { instance: host };
  if (!user) return groups;

  const organizationId = user.organization?.id;
  if (organizationId) groups.organization = organizationId;

  const customerId = user.organization?.customer_id;
  if (customerId) groups.customer = customerId;

  const projectUuid = user.team?.uuid;
  if (projectUuid) groups.project = projectUuid;

  return groups;
}

/**
 * Transport-level errno codes that mean the user's own network or machine
 * dropped a connection mid-call, not that the wizard is broken. Every caller
 * that hits these already degrades on its own — the Slack poll falls back to
 * the connect nudge, a project-tree walk skips the entry, an API caller
 * retries — so a capture adds only noise. And because each errno (and the
 * host string Node folds into a raw socket message) fingerprints as its own
 * error tracking issue, every one-off opens a fresh issue that buries real
 * wizard bugs. Mirrors BENIGN_FS_ERROR_CODES in bounded-fs.ts.
 */
const BENIGN_TRANSPORT_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET', // connection reset by peer / socket dropped
  'ECONNREFUSED', // nothing listening at the far end
  'ETIMEDOUT', // connection or network-backed filesystem read timed out
  'EHOSTUNREACH', // no route to host
  'ENETUNREACH', // no route to network
  'ENETDOWN', // local network interface down
  'EPIPE', // wrote to a closed socket
  'EAI_AGAIN', // temporary DNS resolution failure
]);

/**
 * The benign transport errno for an error, or undefined. Reads the `code`
 * field first (raw socket and filesystem errors carry it), then falls back to
 * the message — api.ts folds the errno into the ApiError message and drops
 * `code`, so the parenthesized "(ECONNRESET)" wrapper is the only trace left.
 * The fallback matches only that wrapper, never a bare mention: several callers
 * wrap raw CLI stderr in a `new Error(...)` when an install fails, and that
 * output can quote a benign errno (a "retrying ECONNRESET" log line) while the
 * command actually failed for an unrelated reason. A bare substring match would
 * silently drop those install failures — a class the team wants to see.
 */
function benignTransportCode(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code && BENIGN_TRANSPORT_ERROR_CODES.has(code)) return code;
  const message = error instanceof Error ? error.message : '';
  for (const candidate of BENIGN_TRANSPORT_ERROR_CODES) {
    if (message.includes(`(${candidate})`)) return candidate;
  }
  return undefined;
}

const WIZARD_FLAGS: ReadonlySet<string> = new Set(WIZARD_FLAG_KEYS);

// Widen back to the SDK's shape — a filter on `true` never matches `'true'`.
function flagResponseValue(value: string): string | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export class Analytics {
  private client: PostHog;
  private tags: Record<string, string | boolean | number | null | undefined> =
    {};
  private distinctId?: string;
  private anonymousId: string;
  private _runId: string;
  private sessionId: string | null = null;
  private appName = 'wizard';
  private activeFlags: Record<string, string> | null = null;
  private activeFlagPayloads: Record<string, unknown> = {};
  private groups: Record<string, string> = {};
  private personProperties: Record<string, string> = {};
  private terminalEventSent = false;

  constructor() {
    this.client = new PostHog(ANALYTICS_POSTHOG_PUBLIC_PROJECT_WRITE_KEY, {
      host: ANALYTICS_HOST_URL,
      flushAt: 1,
      flushInterval: 0,
      enableExceptionAutocapture: true,
      before_send: (event) => {
        if (!event) return event;
        if (Object.keys(this.groups).length > 0) {
          event.groups = { ...this.groups, ...event.groups };
        }
        // Autocaptured exceptions arrive with a random uuid and
        // `$process_person_profile: false` — reattach the run's identity
        // and tags so they land on the same person as everything else.
        if (event.event === '$exception') {
          event.distinctId = this.distinctId ?? this.anonymousId;
          const { $process_person_profile, ...properties } =
            event.properties ?? {};
          void $process_person_profile;
          event.properties = { ...this.tags, ...properties };
        }
        // The SDK captures this one itself, bypassing capture(), so tags merge here.
        if (event.event === '$feature_flag_called') {
          event.properties = { ...this.tags, ...(event.properties ?? {}) };
        }
        return event;
      },
    });

    this.tags = { $app_name: this.appName };
    // Tag every run with its build type so prod / dev / ci / headless segment
    // cleanly in analytics. tsdown inlines IS_PRODUCTION_BUILD to `true` in
    // published builds and `false` for dev/tsx/test runs. Non-interactive runs
    // upgrade this in runWizardCI: dev `--ci` runs to 'ci', published headless
    // runs to 'headless'.
    this.tags.build = IS_PRODUCTION_BUILD ? 'prod' : 'dev';

    this.tags.run_surface = RUN_SURFACE;

    // The build this run came from. Already sent as a flag-evaluation person
    // property; tagging it makes every event attributable to a release, so a
    // regression can be bounded to the versions that carry it.
    this.tags.version = VERSION;

    // Cloud runs only: the task run that owns the sandbox. Without these the
    // wizard's events and the run that launched it are two unrelated streams,
    // since run_id above is minted per process and never leaves the wizard.
    // Left unset for local runs so the properties stay absent rather than null.
    if (TASK_RUN_ID) this.tags.task_run_id = TASK_RUN_ID;
    if (TASK_ID) this.tags.task_id = TASK_ID;

    this.anonymousId = uuidv4();

    // One id per process = one id per wizard run, registered in the tag bag
    // so it rides on every capture, exception, and autocaptured exception
    // (all of which merge `this.tags`). Lets you separate two runs by the
    // same logged-in user, who otherwise share one distinct id. Distinct
    // from `anonymousId`, the pre-login *person* id that gets aliased onto
    // the real user at login. `$session_id` is intentionally not set here —
    // it stays null until OAuth completes (see identifyUser).
    this._runId = uuidv4();
    this.tags.run_id = this._runId;

    this.distinctId = undefined;
  }

  /** Per-process run id, tagged on every event and gateway trace. */
  get runId(): string {
    return this._runId;
  }

  /** Build type for this run ('prod' | 'dev' | 'ci' | 'headless') — the same value tagged on every analytics event. */
  get build(): string {
    return String(this.tags.build ?? 'dev');
  }

  /**
   * Associate the run with the logged-in user, once per id. Identifies them
   * (email, name) and records those person properties so events carry them and
   * feature flags can target the individual user — without the email here the
   * wizard only sends `$app_name`, so email-targeted flags never match. Opens
   * the analytics session on first login, then aliases the run's anonymous id
   * onto the identified person so pre-login events merge in.
   */
  identifyUser(user: ApiUser) {
    const distinctId = user.distinct_id;
    if (this.distinctId === distinctId || distinctId === this.anonymousId) {
      return;
    }
    this.distinctId = distinctId;
    // Open the analytics session on first login. Null until here, so
    // pre-OAuth events carry only `run_id`; from now on every event also
    // carries `$session_id` and PostHog groups the authenticated run into a
    // native Session. Stored in the tag bag so it rides on every subsequent
    // capture and exception.
    if (!this.sessionId) {
      this.sessionId = uuidv4();
      this.tags.$session_id = this.sessionId;
    }
    const props: Record<string, string> = {};
    if (user.email) props.email = user.email;
    const name = [user.first_name, user.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (name) props.name = name;
    this.personProperties = props;
    this.client.identify({ distinctId, properties: { $set: props } });
    this.client.alias({
      distinctId,
      alias: this.anonymousId,
    });
    // The flag snapshot is per identity. Anything evaluated before login (the
    // intro screen reads the tools-menu flag) was anonymous — drop it so the
    // next read re-evaluates as this user.
    this.activeFlags = null;
    this.activeFlagPayloads = {};
  }

  /** Person properties sent with flag evaluation: app name plus the user's. */
  private flagPersonProperties(): Record<string, string> {
    // Environment facts flag conditions can scope on — evaluation-time only,
    // never persisted onto the person. `version` gates an experiment to
    // releases that implement it (a condition on a property older builds
    // don't send silently never matches them); `run_surface`/`build` scope
    // by invocation surface; `command`/`cli_flags` by subcommand; `os`/
    // `node_major` by platform.
    return {
      $app_name: this.appName,
      version: VERSION,
      run_surface: RUN_SURFACE,
      build: String(this.tags.build ?? 'dev'),
      os: process.platform,
      node_major: process.versions.node.split('.')[0],
      ...invocationProperties(),
      ...this.personProperties,
    };
  }

  setTag(key: string, value: string | boolean | number | null | undefined) {
    this.tags[key] = value;
  }

  setGroups(groups: Record<string, string>) {
    this.groups = groups;
  }

  captureException(error: Error, properties: Record<string, unknown> = {}) {
    // Drop transport-level failures on the user's side. They never mean the
    // wizard is broken and each variant opens its own error tracking issue.
    const benign = benignTransportCode(error);
    if (benign) {
      // This debug line is the only record of a dropped failure, and the same
      // errno can come from unrelated operations (a Slack poll, a project-tree
      // read, a doctor fetch). Keep the operation context (step/source) and the
      // message so support can name what failed — callers already redact
      // secrets from these before reporting. Mirrors bounded-fs's skip log.
      const op = properties.step ?? properties.source;
      logToFile(
        `[analytics] skipped benign transport error (${benign})${
          op ? ` [${String(op)}]` : ''
        }: ${error.message}`,
      );
      return;
    }
    this.client.captureException(error, this.distinctId ?? this.anonymousId, {
      team: ANALYTICS_TEAM_TAG,
      ...this.tags,
      ...properties,
    });
  }

  /** Normalize an unknown throw to an Error, then capture it. */
  captureUnknown(error: unknown, properties: Record<string, unknown> = {}) {
    this.captureException(
      error instanceof Error ? error : new Error(String(error)),
      properties,
    );
  }

  capture(eventName: string, properties?: Record<string, unknown>) {
    this.client.capture({
      distinctId: this.distinctId ?? this.anonymousId,
      event: eventName,
      properties: {
        ...this.tags,
        ...this.wizardFlagFeatureProperties(),
        ...properties,
      },
    });
  }

  groupIdentify(
    groupType: string,
    groupKey: string,
    properties: Record<string, unknown>,
  ) {
    this.client.groupIdentify({ groupType, groupKey, properties });
  }

  // Built from the resolved map, not the SDK snapshot: a CI-forced variant must own its events.
  private wizardFlagFeatureProperties(): Record<string, unknown> {
    if (this.activeFlags === null) return {};
    const props: Record<string, unknown> = {};
    const active: string[] = [];
    for (const [key, value] of Object.entries(this.activeFlags)) {
      if (!WIZARD_FLAGS.has(key)) continue;
      const resolved = flagResponseValue(value);
      props[`$feature/${key}`] = resolved;
      if (resolved !== false) active.push(key);
    }
    if (active.length > 0) props.$active_feature_flags = active.sort();
    return props;
  }

  /**
   * Capture a wizard-specific event. Automatically prepends "wizard: " to the event name.
   * All new wizard analytics should use this method instead of capture() directly.
   */
  wizardCapture(eventName: string, properties?: Record<string, unknown>): void {
    this.capture(`wizard: ${eventName}`, properties);
  }

  /**
   * Flush pending events without firing the "setup wizard finished" terminal
   * event. Use this from CLI error paths that exit before any wizard run
   * starts — `shutdown()` would inflate the run count with a "finished" event
   * for a parse error that never actually ran the wizard.
   */
  async flush(): Promise<void> {
    await this.client.shutdown();
  }

  /**
   * Evaluate all feature flags for the current user at the start of a run.
   * Result is cached; subsequent calls in the same run return the same map.
   * Returns flag key -> string value (booleans become 'true'/'false').
   */
  // Only a getFlag read records an exposure; the bulk response records none.
  async getAllFlagsForWizard(): Promise<Record<string, string>> {
    if (this.activeFlags !== null) {
      return this.activeFlags;
    }
    const out: Record<string, string> = {};
    const payloads: Record<string, unknown> = {};
    try {
      const distinctId = this.distinctId ?? this.anonymousId;
      logToFile('[flags] evaluating as', {
        distinctId,
        identified: this.distinctId !== undefined,
        personProperties: this.flagPersonProperties(),
      });
      const evaluation = await this.client.evaluateFlags(distinctId, {
        personProperties: this.flagPersonProperties(),
      });
      for (const key of WIZARD_FLAG_KEYS) {
        const value = evaluation.getFlag(key);
        if (value === undefined) continue;
        out[key] = String(value);
        const payload = evaluation.getFlagPayload(key);
        if (payload !== undefined) payloads[key] = payload;
      }
    } catch (error) {
      debug('Failed to get all feature flags:', error);
      this.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { step: 'get_all_flags' },
      );
    }
    // Outside the fetch guard on purpose: a malformed CI override must fail
    // the run loudly, and a valid one applies even when the fetch failed —
    // CI routing stays deterministic either way.
    const merged = applyCiFlagOverrides(out, payloads);
    this.activeFlags = merged.flags;
    this.activeFlagPayloads = merged.payloads;
    logToFile('[flags] evaluated', this.activeFlags);
    return this.activeFlags;
  }

  /** Flag payloads from the same snapshot; empty until the flags are fetched. */
  getWizardFlagPayloads(): Record<string, unknown> {
    return this.activeFlagPayloads;
  }

  async shutdown(status: 'success' | 'error' | 'cancelled') {
    if (Object.keys(this.tags).length === 0) {
      return;
    }

    // First status wins. The interrupt fallback in start-tui fires
    // shutdown('cancelled') on every TUI teardown; without this guard a run
    // that already reported 'success' would emit a second, contradicting
    // terminal event when the user dismisses the outro.
    if (this.terminalEventSent) {
      return;
    }
    this.terminalEventSent = true;

    this.client.capture({
      distinctId: this.distinctId ?? this.anonymousId,
      event: 'setup wizard finished',
      properties: {
        // Flat for filtering; the nested `tags` snapshot stays for back-compat.
        ...this.tags,
        run_id: this._runId,
        ...(this.sessionId ? { $session_id: this.sessionId } : {}),
        status,
        tags: this.tags,
      },
    });

    await this.client.shutdown();
  }
}

export const analytics = new Analytics();
