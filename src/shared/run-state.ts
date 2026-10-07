/** Run lifecycle and consent states the TUI, the CLI and programs share. */

import type { DiscoveredFeature } from './discovered-feature';

/** How an agent run ended: the agent decides it, and the programs and hosts read it. */
export enum RunOutcome {
  Success = 'success',
  Aborted = 'aborted',
  Failed = 'failed',
  Crashed = 'crashed',
}

/** Lifecycle phase of the main work (agent run, MCP install, etc.) */
export enum RunPhase {
  /** Still gathering input (intro, setup screens) */
  Idle = 'idle',
  /** Main work is in progress */
  Running = 'running',
  /** Main work finished successfully */
  Completed = 'completed',
  /** Main work finished with an error */
  Error = 'error',
}

/** Consent to report what local detection found (see `scanConsent` below). */
export enum ScanConsent {
  Undecided = 'undecided',
  Granted = 'granted',
  Declined = 'declined',
}

/** Outcome of the MCP server installation step */
export enum McpOutcome {
  NoClients = 'no_clients',
  Skipped = 'skipped',
  Installed = 'installed',
  Failed = 'failed',
}

/** One place to ask, so a new consent state does not need three edits. */
export function mayReportScanResults(session: {
  scanConsent: ScanConsent;
}): boolean {
  return session.scanConsent === ScanConsent.Granted;
}

/** Lives here so analytics infrastructure never learns what consent means. */
export function reportableDiscoveredFeatures(session: {
  scanConsent: ScanConsent;
  discoveredFeatures: DiscoveredFeature[];
}): DiscoveredFeature[] | undefined {
  return mayReportScanResults(session) ? session.discoveredFeatures : undefined;
}

/** Also a scan result, so it travels under the same consent as the rest. */
export function reportablePosthogSdkDetected(session: {
  scanConsent: ScanConsent;
  posthogSdkDetected: boolean;
}): boolean | undefined {
  return mayReportScanResults(session) ? session.posthogSdkDetected : undefined;
}
