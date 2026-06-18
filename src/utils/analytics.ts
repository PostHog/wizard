import { PostHog } from 'posthog-node';
import {
  ANALYTICS_HOST_URL,
  ANALYTICS_POSTHOG_PUBLIC_PROJECT_WRITE_KEY,
  ANALYTICS_TEAM_TAG,
} from '@lib/constants';
import type { WizardSession } from '@lib/wizard-session';
import type { ApiUser } from '@lib/api';
import { v4 as uuidv4 } from 'uuid';
import { IS_PRODUCTION_BUILD } from '@env';
import { debug } from './debug';

/**
 * Extract a standard property bag from the current session.
 * Used by store-level analytics and available for ad-hoc captures.
 */
export function sessionProperties(
  session: WizardSession,
): Record<string, unknown> {
  return {
    integration: session.integration,
    detected_framework: session.detectedFrameworkLabel,
    typescript: session.typescript,
    project_id: session.credentials?.projectId,
    discovered_features: session.discoveredFeatures,
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

export class Analytics {
  private client: PostHog;
  private tags: Record<string, string | boolean | number | null | undefined> =
    {};
  private distinctId?: string;
  private anonymousId: string;
  private runId: string;
  private sessionId: string | null = null;
  private appName = 'wizard';
  private activeFlags: Record<string, string> | null = null;
  private groups: Record<string, string> = {};

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
        return event;
      },
    });

    this.tags = { $app_name: this.appName };
    // Tag every run with its build type so prod / dev / ci segment cleanly
    // in analytics. tsdown inlines IS_PRODUCTION_BUILD to `true` in published
    // builds and `false` for dev/tsx/test runs. CI runs (always non-prod
    // builds) upgrade this to 'ci' in runWizardCI.
    this.tags.build = IS_PRODUCTION_BUILD ? 'prod' : 'dev';

    this.anonymousId = uuidv4();

    // One id per process = one id per wizard run, registered in the tag bag
    // so it rides on every capture, exception, and autocaptured exception
    // (all of which merge `this.tags`). Lets you separate two runs by the
    // same logged-in user, who otherwise share one distinct id. Distinct
    // from `anonymousId`, the pre-login *person* id that gets aliased onto
    // the real user at login. `$session_id` is intentionally not set here —
    // it stays null until OAuth completes (see identifyUser).
    this.runId = uuidv4();
    this.tags.run_id = this.runId;

    this.distinctId = undefined;
  }

  /**
   * Associate the run with the logged-in user, once per id: identify them
   * (email, name), then alias the run's anonymous id onto the identified
   * person so pre-login events merge in. Alias only ever fires after
   * identification.
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
    this.client.identify({
      distinctId,
      properties: {
        $set: {
          ...(user.email ? { email: user.email } : {}),
          ...(user.first_name || user.last_name
            ? {
                name: [user.first_name, user.last_name]
                  .filter(Boolean)
                  .join(' '),
              }
            : {}),
        },
      },
    });
    this.client.alias({
      distinctId,
      alias: this.anonymousId,
    });
  }

  setTag(key: string, value: string | boolean | number | null | undefined) {
    this.tags[key] = value;
  }

  setGroups(groups: Record<string, string>) {
    this.groups = groups;
  }

  captureException(error: Error, properties: Record<string, unknown> = {}) {
    this.client.captureException(error, this.distinctId ?? this.anonymousId, {
      team: ANALYTICS_TEAM_TAG,
      ...this.tags,
      ...properties,
    });
  }

  capture(eventName: string, properties?: Record<string, unknown>) {
    this.client.capture({
      distinctId: this.distinctId ?? this.anonymousId,
      event: eventName,
      properties: {
        ...this.tags,
        ...properties,
      },
    });
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

  async getFeatureFlag(flagKey: string): Promise<string | boolean | undefined> {
    try {
      const distinctId = this.distinctId ?? this.anonymousId;
      return await this.client.getFeatureFlag(flagKey, distinctId, {
        sendFeatureFlagEvents: true,
        personProperties: {
          $app_name: this.appName,
        },
      });
    } catch (error) {
      debug('Failed to get feature flag:', flagKey, error);
      return undefined;
    }
  }

  /**
   * Evaluate all feature flags for the current user at the start of a run.
   * Result is cached; subsequent calls in the same run return the same map.
   * Returns flag key -> string value (booleans become 'true'/'false').
   */
  async getAllFlagsForWizard(): Promise<Record<string, string>> {
    if (this.activeFlags !== null) {
      return this.activeFlags;
    }
    try {
      const distinctId = this.distinctId ?? this.anonymousId;
      const result = await this.client.getAllFlagsAndPayloads(distinctId, {
        personProperties: { $app_name: this.appName },
      });
      const flags = result.featureFlags ?? {};
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(flags)) {
        if (value === undefined) continue;
        out[key] = typeof value === 'boolean' ? String(value) : String(value);
      }
      this.activeFlags = out;
      return out;
    } catch (error) {
      debug('Failed to get all feature flags:', error);
      return {};
    }
  }

  async shutdown(status: 'success' | 'error' | 'cancelled') {
    if (Object.keys(this.tags).length === 0) {
      return;
    }

    this.client.capture({
      distinctId: this.distinctId ?? this.anonymousId,
      event: 'setup wizard finished',
      properties: {
        // Hoisted out of `tags` so the run's terminal event is filterable by
        // run, and joins the session when one was opened (post-OAuth runs).
        run_id: this.runId,
        ...(this.sessionId ? { $session_id: this.sessionId } : {}),
        status,
        tags: this.tags,
      },
    });

    await this.client.shutdown();
  }
}

export const analytics = new Analytics();
