/**
 * The one place discovery is cleared to leave the machine. Runs only
 * when the user granted sharing (CI and headless runs grant it) and telemetry
 * is on.
 *
 * Called when consent resolves (the intro's Continue) and again after login,
 * because either can happen first. Each part latches, so a run reports once:
 *   - the `warehouse sources detected` event, which needs no login
 *   - the report, which needs the login for its fingerprint. This hands it to
 *     the task stream, which attaches it to the run's wizard session, and
 *     sends the email providers it found on one event.
 */

import path from 'path';
import { mayReportDiscovery } from '@shared/run-state';
import { VERSION } from '@shared/version';
import { analytics } from '@utils/analytics';
import type { WizardSession } from '../session/wizard-session';
import { detectedEmailProviders } from './email-providers';
import { workspaceFingerprint } from './fingerprint';
import { getDiscovery, type Discovery } from './discover';
import { applyDiscoveryTags } from './tags';
import { toolsUnder } from './tools';
import { summarizePosthogSdks } from './traits/sdks';
import type { DiscoveryReport } from '../session/task-stream/types';

/** The store surface reporting needs; `SessionStore` provides it. */
export type DiscoveryReportStore = {
  readonly session: WizardSession;
  markWarehouseSourcesReportedIfNeeded(): void;
  shareDiscovery(report: DiscoveryReport): void;
};

export function buildDiscoveryReport(
  discovery: Discovery,
  projectId: number,
): DiscoveryReport {
  return {
    program: discovery.program,
    wizard_version: VERSION,
    // The folder the run started in, in every flag mode. A CI run's install dir may no longer be it.
    workspace_fingerprint: workspaceFingerprint(
      projectId,
      path.resolve(discovery.runDir),
    ),
    scanned_at: discovery.discoveredAt,
    complete: discovery.tools.complete,
    // Only the run project's tools: a sibling's never travel under this fingerprint.
    tools: toolsUnder(discovery.tools.tools, discovery.runProject).map(
      (tool) => ({ kind: tool.kind, signals: tool.signals }),
    ),
  };
}

export function reportDiscovery(store: DiscoveryReportStore): void {
  const { session } = store;
  if (session.noTelemetry) return;
  // Synchronous on purpose: callers rely on the event and its tags landing
  // before whatever they capture next.
  applyDiscoveryTags(session);
  store.markWarehouseSourcesReportedIfNeeded();

  if (!mayReportDiscovery(session)) return;
  const discovery = getDiscovery(session);
  const sdkSummary = discovery ? summarizeRunSdks(session, discovery) : null;
  if (sdkSummary) applySdkTags(sdkSummary);

  const { credentials } = session;
  if (!credentials) return;

  if (session.discoveryReport) return;
  // A failed tool match found nothing because it could not look. Posting its
  // empty list would read as "every tool was removed".
  if (!discovery || discovery.tools.failed) return;
  if (session.apiUser) reportEmailProviders(discovery);
  if (sdkSummary) analytics.wizardCapture('posthog sdks detected', sdkSummary);
  store.shareDiscovery(buildDiscoveryReport(discovery, credentials.projectId));
}

function summarizeRunSdks(session: WizardSession, discovery: Discovery) {
  return summarizePosthogSdks(
    discovery.files.manifests.filter((m) => m.dir === session.runProject),
  );
}

function applySdkTags(summary: ReturnType<typeof summarizePosthogSdks>): void {
  analytics.setTag('has_existing_sdk', summary.has_existing_sdk);
  analytics.setTag('detected_sdk_count', summary.detected_sdk_count);
  if (summary.sdk_version_found) {
    analytics.setTag('sdk_version_found', summary.sdk_version_found);
  }
  if (summary.sdk_version_pin) {
    analytics.setTag('sdk_version_pin', summary.sdk_version_pin);
  }
}

function reportEmailProviders(discovery: Discovery): void {
  const providers = detectedEmailProviders(discovery);
  if (providers.length === 0) return;
  analytics.wizardCapture('email providers detected', {
    email_provider_kinds: providers.map((provider) => provider.kind),
  });
}
