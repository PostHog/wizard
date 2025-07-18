/**
 * PostHog helper
 *
 * This helper abstracts PostHog interactions for both client and server environments.
 * It automatically detects the runtime context and uses the appropriate PostHog library.
 * This code was written and reviewed by real humans. The PostHog wizard copied it into your project, but did not generate it from scratch. It's a bit more complete than the basic install instructions, that's why it looks different.
 *
 * Usage:
 * - Import and use the same functions in both client and server code
 * - No need to worry about which PostHog library to use
 * - Server-side events are automatically flushed using Next.js after()
 *
 * This is a starting place! If you want this file to do more, go right ahead and enhance it for your needs.
 */

// This is a template file that will be copied to Next.js projects
declare const window: any;

// Import client-side PostHog (safe to import everywhere)
// @ts-ignore
import { posthog as posthogJS } from 'posthog-js';

// Keep a singleton instance for server-side PostHog
let serverPostHog: any = null;
let PostHogNode: any = null;

/**
 * Get or create the server-side PostHog instance
 * We keep a singleton to avoid creating multiple instances
 */
async function getServerPostHog() {
  if (!serverPostHog && typeof window === 'undefined') {
    // Dynamically import posthog-node only on the server
    if (!PostHogNode) {
      const posthogNodeModule = await import('posthog-node');
      PostHogNode = posthogNodeModule.PostHog;
    }

    serverPostHog = new PostHogNode(process.env.NEXT_PUBLIC_POSTHOG_KEY || '', {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
      flushAt: 20, // Batch up to 20 events
      flushInterval: 30000, // Flush every 30 seconds
    });
  }
  return serverPostHog;
}

/**
 * Schedule a flush after the response is sent (server-side only)
 * Uses Next.js after() to defer flushing until after the response
 */
async function scheduleFlush(ph: any) {
  // @ts-ignore - This module will exist in the target Next.js project
  const { after } = await import('next/server');
  after(() => ph.flush());
}

/**
 * Capture an analytics event
 *
 * @param eventName - The name of the event (e.g., 'button-clicked', 'form-submitted')
 * @param properties - Optional properties to attach to the event
 *
 * @example
 * // Client-side usage
 * captureEvent('button-clicked', { buttonName: 'signup', location: 'header' })
 *
 * // Server-side usage (in API routes or server actions)
 * captureEvent('api-called', { endpoint: '/api/users', method: 'POST' })
 */
export function captureEvent(
  eventName: string,
  properties?: Record<string, any>,
): void {
  try {
    if (typeof window !== 'undefined') {
      // Client-side: use posthog-js
      // Assumes PostHog is already initialized via instrumentation-client
      posthogJS.capture(eventName, properties);
    } else {
      // Server-side: use posthog-node (async)
      void getServerPostHog()
        .then((ph) => {
          if (ph) {
            void scheduleFlush(ph);

            ph.capture({
              distinctId: properties?.$distinct_id || 'anonymous',
              event: eventName,
              properties: properties || {},
            });
          }
        })
        .catch((error) => {
          // eslint-disable-next-line no-console
          console.error(
            '[PostHog helper] Error getting server PostHog:',
            error,
          );
        });
    }
  } catch (error) {
    // Fail silently to not break the application
    // eslint-disable-next-line no-console
    console.error('[PostHog helper] Error capturing event:', error);
  }
}

/**
 * Identify a user for analytics tracking
 *
 * @param userId - The unique identifier for the user
 * @param properties - Optional user properties (email, name, etc.)
 *
 * @example
 * // After user signs in
 * postHogIdentify(user.id, {
 *   email: user.email,
 *   name: user.name,
 *   plan: 'premium'
 * })
 */
export function postHogIdentify(
  userId: string,
  properties?: Record<string, any>,
): void {
  try {
    if (typeof window !== 'undefined') {
      // Client-side: use posthog-js
      posthogJS.identify(userId, properties);
    } else {
      // Server-side: use posthog-node (async)
      void getServerPostHog()
        .then((ph) => {
          if (ph) {
            void scheduleFlush(ph);

            ph.identify({
              distinctId: userId,
              properties: properties || {},
            });
          }
        })
        .catch((error) => {
          // eslint-disable-next-line no-console
          console.error(
            '[PostHog helper] Error getting server PostHog:',
            error,
          );
        });
    }
  } catch (error) {
    // Fail silently to not break the application
    // eslint-disable-next-line no-console
    console.error('[PostHog helper] Error identifying user:', error);
  }
}

// For JavaScript projects that might not have proper TypeScript types
export default {
  captureEvent,
  postHogIdentify,
};
