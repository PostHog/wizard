/** What `sessionProperties` reports for a session `buildSession` made: scan results wait on consent. */
import { sessionProperties } from '@utils/analytics';
import { DiscoveredFeature } from '@shared/discovered-feature';
import { ScanConsent } from '@shared/run-state';
import { buildSession } from '../wizard-session';

describe('sessionProperties: the SDK verdict', () => {
  it('includes the posthog_sdk_detected verdict once sharing is granted', () => {
    const session = buildSession({});
    session.scanConsent = ScanConsent.Granted;
    expect(sessionProperties(session).posthog_sdk_detected).toBe(false);

    session.posthogSdkDetected = true;
    expect(sessionProperties(session).posthog_sdk_detected).toBe(true);
  });

  // It is a package.json scan result, so it waits on the same consent.
  it('omits the verdict while consent is undecided or declined', () => {
    const session = buildSession({});
    session.posthogSdkDetected = true;

    expect(session.scanConsent).toBe(ScanConsent.Undecided);
    expect(sessionProperties(session)).not.toHaveProperty(
      'posthog_sdk_detected',
    );

    session.scanConsent = ScanConsent.Declined;
    expect(sessionProperties(session)).not.toHaveProperty(
      'posthog_sdk_detected',
    );
  });
});

describe('sessionProperties: discovered features', () => {
  it('includes discovered_features once consent is granted', () => {
    const session = buildSession({ installDir: '/tmp/app' });
    session.discoveredFeatures = [DiscoveredFeature.Stripe];
    session.scanConsent = ScanConsent.Granted;

    const properties = sessionProperties(session);

    expect(properties.discovered_features).toEqual([DiscoveredFeature.Stripe]);
  });

  it('omits discovered_features entirely when the user declined sharing', () => {
    const session = buildSession({ installDir: '/tmp/app' });
    session.discoveredFeatures = [DiscoveredFeature.Stripe];
    session.scanConsent = ScanConsent.Declined;

    const properties = sessionProperties(session);

    expect(properties).not.toHaveProperty('discovered_features');
  });

  it('omits discovered_features on a --signup run before the user answers', () => {
    // --signup renders the full TUI, so these events fire while the intro
    // screen is still on screen. Granting on the flag would put scan results
    // on every one of them, including for a user who then declines.
    const session = buildSession({ installDir: '/tmp/app', signup: true });
    session.discoveredFeatures = [DiscoveredFeature.Stripe];

    const properties = sessionProperties(session);

    expect(properties).not.toHaveProperty('discovered_features');
  });

  it('omits discovered_features while consent is still undecided', () => {
    const session = buildSession({ installDir: '/tmp/app' });
    session.discoveredFeatures = [DiscoveredFeature.Stripe];
    session.scanConsent = ScanConsent.Undecided;

    const properties = sessionProperties(session);

    // Undecided reads the same as declined: a path that reports before the
    // user has been asked must send nothing, not everything.
    expect(properties).not.toHaveProperty('discovered_features');
  });

  it('sends scan_consent in every state, so an absent list is explainable', () => {
    for (const consent of [
      ScanConsent.Undecided,
      ScanConsent.Granted,
      ScanConsent.Declined,
    ]) {
      const session = buildSession({ installDir: '/tmp/app' });
      session.scanConsent = consent;

      expect(sessionProperties(session).scan_consent).toBe(consent);
    }
  });

  it('never sends an empty array in place of the omitted key', () => {
    const session = buildSession({ installDir: '/tmp/app' });
    session.discoveredFeatures = [];
    session.scanConsent = ScanConsent.Declined;

    const properties = sessionProperties(session);

    // Absent, not []. An empty array would misread as "we looked and found
    // nothing" instead of "we didn't report what we found".
    expect('discovered_features' in properties).toBe(false);
  });

  it('leaves every other property untouched by a decline', () => {
    const session = buildSession({ installDir: '/tmp/app' });
    session.scanConsent = ScanConsent.Declined;
    session.integration = null;

    const properties = sessionProperties(session);

    expect(properties).toMatchObject({
      integration: null,
      detected_framework: null,
      typescript: false,
      run_phase: session.runPhase,
    });
  });
});
