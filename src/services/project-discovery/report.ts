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
    // The project the run started in, which a CI run's install dir may no longer be.
    workspace_fingerprint: workspaceFingerprint(
      projectId,
      path.resolve(discovery.rootDir, discovery.runProject),
    ),
    scanned_at: discovery.discoveredAt,
    complete: discovery.tools.complete,
    // Only that project's tools: a sibling's never travel under its fingerprint.
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
  const { credentials } = session;
  if (!credentials) return;

  if (session.discoveryReport) return;
  const discovery = getDiscovery(session);
  // A failed tool match found nothing because it could not look. Posting its
  // empty list would read as "every tool was removed".
  if (!discovery || discovery.tools.failed) return;
  if (session.apiUser) reportEmailProviders(discovery);
  store.shareDiscovery(buildDiscoveryReport(discovery, credentials.projectId));
}

function reportEmailProviders(discovery: Discovery): void {
  const providers = detectedEmailProviders(discovery);
  if (providers.length === 0) return;
  analytics.wizardCapture('email providers detected', {
    email_provider_kinds: providers.map((provider) => provider.kind),
  });
}
