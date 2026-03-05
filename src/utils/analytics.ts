import { PostHog } from 'posthog-node';
import {
  ANALYTICS_HOST_URL,
  ANALYTICS_POSTHOG_PUBLIC_PROJECT_WRITE_KEY,
  ANALYTICS_TEAM_TAG,
} from '../lib/constants';
import type { WizardSession } from '../lib/wizard-session';
import { v4 as uuidv4 } from 'uuid';
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
export class Analytics {
  private client: PostHog;
  private tags: Record<string, string | boolean | number | null | undefined> =
    {};
  private distinctId?: string;
  private anonymousId: string;
  private appName = 'wizard';
  private activeFlags: Record<string, string> | null = null;

  constructor() {
    this.client = new PostHog(ANALYTICS_POSTHOG_PUBLIC_PROJECT_WRITE_KEY, {
      host: ANALYTICS_HOST_URL,
      flushAt: 1,
      flushInterval: 0,
      enableExceptionAutocapture: true,
    });

    this.tags = { $app_name: this.appName };

    this.anonymousId = uuidv4();

    this.distinctId = undefined;
  }

  setDistinctId(distinctId: string) {
    this.distinctId = distinctId;
    this.client.alias({
      distinctId,
      alias: this.anonymousId,
    });
  }

  setTag(key: string, value: string | boolean | number | null | undefined) {
    this.tags[key] = value;
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
        status,
        tags: this.tags,
      },
    });

    await this.client.shutdown();
  }
}

export const analytics = new Analytics();
