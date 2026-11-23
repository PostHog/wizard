/**
 * Analytics tags a program derives from discovery. They are discovery
 * results, so they leave the machine under the same consent as the discovery
 * report. Local suggestions read discovery itself and never wait on this.
 */

import { mayReportDiscovery } from '@shared/run-state';
import { analytics } from '@utils/analytics';
import type { ProgramSession } from '@programs/program-contract';

/** frameworkContext key holding the tags, kept until sharing is granted. */
export const DISCOVERY_TAGS_KEY = 'discoveryTags';

export type DiscoveryTags = Record<string, string | number>;

/** Discovery results may leave the machine: sharing is granted and telemetry is on. */
export function maySendDiscovery(
  session: Pick<ProgramSession, 'noTelemetry' | 'discoveryConsent'>,
): boolean {
  return !session.noTelemetry && mayReportDiscovery(session);
}

function getDiscoveryTags(session: ProgramSession): DiscoveryTags {
  return (
    (session.frameworkContext[DISCOVERY_TAGS_KEY] as
      | DiscoveryTags
      | undefined) ?? {}
  );
}

function setTags(tags: DiscoveryTags): void {
  for (const [key, value] of Object.entries(tags)) {
    analytics.setTag(key, value);
  }
}

/**
 * Tag later analytics events with what discovery found. A CI or headless run
 * starts with sharing granted, so the tags apply at once. An interactive run
 * keeps them until `reportDiscovery` sees the user grant sharing.
 */
export function tagDiscovery(
  session: ProgramSession,
  setFrameworkContext: (key: string, value: unknown) => void,
  tags: DiscoveryTags,
): void {
  const merged = { ...getDiscoveryTags(session), ...tags };
  setFrameworkContext(DISCOVERY_TAGS_KEY, merged);
  if (maySendDiscovery(session)) setTags(merged);
}

/** Apply the kept tags once sharing is granted. Setting a tag twice is harmless. */
export function applyDiscoveryTags(session: ProgramSession): void {
  if (maySendDiscovery(session)) setTags(getDiscoveryTags(session));
}
