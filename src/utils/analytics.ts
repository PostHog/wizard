import { PostHog } from 'posthog-node';
import {
  ANALYTICS_HOST_URL,
  ANALYTICS_POSTHOG_PUBLIC_PROJECT_WRITE_KEY,
} from '../lib/constants';
import { v4 as uuidv4 } from 'uuid';
import { debug } from './debug';
export class Analytics {
  private client: PostHog;
  private tags: Record<string, string | boolean | number | null | undefined> =
    {};
  private distinctId?: string;
  private anonymousId: string;
  private appName = 'wizard';

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
      team: 'growth',
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

  async getFeatureFlag(flagKey: string): Promise<string | boolean | undefined> {
    try {
      const distinctId = this.distinctId ?? this.anonymousId;
      return await this.client.getFeatureFlag(flagKey, distinctId, {
        sendFeatureFlagEvents: true,
      });
    } catch (error) {
      debug('Failed to get feature flag:', flagKey, error);
      return undefined;
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
