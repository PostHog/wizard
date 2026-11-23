import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSession } from '@services/session';
import { DISCOVERY_KEY, type Discovery } from '@services/project-discovery';
import { HostResolution } from '@shared/host-resolution';
import { OutroKind } from '@shared/outro';
import { DiscoveryConsent } from '@shared/run-state';
import type { ProgramSession } from '@programs/program-contract';
import type { ApiUser } from '@shared/api';
import { analytics } from '@utils/analytics';
import { emailProviderOffer } from '@programs/posthog-integration';

function detected(kind: string, label: string) {
  return {
    kind,
    label,
    warehouseSourceType: null,
    mode: null,
    matchedSignal: `package ${kind.toLowerCase()}`,
    signals: [],
  };
}

/** The offer reads only the tool match, so the fixture holds nothing else of the discovery. */
type Finding = Pick<Discovery, 'tools'>;

function scanFinding(...tools: ReturnType<typeof detected>[]): Finding {
  return { tools: { tools, complete: true } };
}

function finishedRun(
  scan: Finding,
  overrides: Partial<ProgramSession> = {},
): ProgramSession {
  const session = buildSession({ installDir: '/tmp/app' });
  session.discoveryConsent = DiscoveryConsent.Granted;
  session.frameworkContext[DISCOVERY_KEY] = scan;
  session.outroData = { kind: OutroKind.Success, message: 'Done' };
  session.credentials = {
    accessToken: 'token',
    projectApiKey: 'phc_example',
    host: HostResolution.fromApiHost('https://us.posthog.com'),
    projectId: 42,
  };
  session.apiUser = { distinct_id: 'user-distinct-id' } as ApiUser;
  return Object.assign(session, overrides);
}

const RESEND = detected('Resend', 'Resend');

function flagsAre(flags: Record<string, string> | null): void {
  vi.spyOn(analytics, 'getCachedWizardFlags').mockReturnValue(flags);
}

beforeEach(() => flagsAre({ 'wizard-email-provider-offer': 'true' }));

describe('emailProviderOffer', () => {
  it('offers Workflows in the project to a run that found a provider', () => {
    const offer = emailProviderOffer(
      finishedRun(
        scanFinding(
          detected('Stripe', 'Stripe'),
          RESEND,
          detected('AwsSes', 'Amazon SES'),
        ),
      ),
    );

    expect(offer).toEqual({
      providers: ['Resend', 'AwsSes'],
      workflowsUrl:
        'https://us.posthog.com/project/42/workflows?source=wizard_cli',
      projectId: 42,
      installDir: '/tmp/app',
    });
  });

  it('keeps the instance a run pinned with --base-url', () => {
    const offer = emailProviderOffer(
      finishedRun(scanFinding(RESEND), { baseUrl: 'http://localhost:8010' }),
    );

    expect(offer?.baseUrl).toBe('http://localhost:8010');
  });

  it('treats a blank --base-url as no pin, as host resolution does', () => {
    const offer = emailProviderOffer(
      finishedRun(scanFinding(RESEND), { baseUrl: '  ' }),
    );

    expect(offer?.baseUrl).toBeUndefined();
  });

  function pinnedRun(baseUrl: string): ProgramSession {
    const run = finishedRun(scanFinding(RESEND), { baseUrl });
    if (!run.credentials) throw new Error('A finished run has credentials');
    run.credentials = {
      ...run.credentials,
      host: HostResolution.fromRegion('us', { baseUrl }),
    };
    return run;
  }

  it.each([
    [
      'https://user:secret@example.com/posthog/',
      'https://example.com/posthog/project/42/workflows?source=wizard_cli',
    ],
    [
      'https://example.com/pos\nthog',
      'https://example.com/posthog/project/42/workflows?source=wizard_cli',
    ],
    [
      'http://[::1]:8010',
      'http://[::1]:8010/project/42/workflows?source=wizard_cli',
    ],
  ])(
    'links to Workflows on the pinned instance %j without its credentials or line breaks',
    (baseUrl, link) => {
      expect(emailProviderOffer(pinnedRun(baseUrl))?.workflowsUrl).toBe(link);
    },
  );

  it.each(['not a url', 'file:///srv/posthog', 'javascript:alert(1)'])(
    'asks nothing when the pinned instance %j is no web page it can link to',
    (baseUrl) => {
      expect(emailProviderOffer(pinnedRun(baseUrl))).toBeUndefined();
    },
  );

  it.each<[string, (scan: Finding) => ProgramSession]>([
    ['a CI run', (scan) => finishedRun(scan, { ci: true })],
    ['telemetry is off', (scan) => finishedRun(scan, { noTelemetry: true })],
    [
      'sharing was declined',
      (scan) =>
        finishedRun(scan, { discoveryConsent: DiscoveryConsent.Declined }),
    ],
    [
      'the install failed',
      (scan) =>
        finishedRun(scan, {
          outroData: { kind: OutroKind.Error, message: 'failed' },
        }),
    ],
    [
      'the user is not logged in',
      (scan) => finishedRun(scan, { credentials: null }),
    ],
    [
      'the run could not identify the user',
      (scan) => finishedRun(scan, { apiUser: null }),
    ],
  ])('stays silent when %s', (_case, sessionFor) => {
    expect(emailProviderOffer(sessionFor(scanFinding(RESEND)))).toBeUndefined();
  });

  it('stays silent when the scan found no email provider', () => {
    expect(
      emailProviderOffer(
        finishedRun(scanFinding(detected('Stripe', 'Stripe'))),
      ),
    ).toBeUndefined();
  });

  it.each<[string, Record<string, string> | null]>([
    ['the flag is off', { 'wizard-email-provider-offer': 'false' }],
    ['the flag evaluation left the flag out', {}],
    ['no flag evaluation finished', null],
  ])('stays silent when %s', (_case, flags) => {
    flagsAre(flags);
    expect(
      emailProviderOffer(finishedRun(scanFinding(RESEND))),
    ).toBeUndefined();
  });

  it.each<[string, ReturnType<typeof detected>[]]>([
    ['one provider', [RESEND]],
    ['two providers', [RESEND, detected('SendGrid', 'SendGrid')]],
    [
      'three providers',
      [
        RESEND,
        detected('SendGrid', 'SendGrid'),
        detected('Postmark', 'Postmark'),
      ],
    ],
  ])('keeps every provider kind for analytics with %s', (_case, tools) => {
    const offer = emailProviderOffer(finishedRun(scanFinding(...tools)));

    expect(offer?.providers).toEqual(tools.map((tool) => tool.kind));
  });
});
