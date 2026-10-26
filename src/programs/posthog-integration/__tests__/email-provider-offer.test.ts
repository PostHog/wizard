import { describe, expect, it } from 'vitest';
import { buildSession } from '@services/session';
import { CODEBASE_SCAN_KEY, type CodebaseScan } from '@services/codebase-scan';
import { HostResolution } from '@shared/host-resolution';
import { OutroKind } from '@shared/outro';
import { ScanConsent } from '@shared/run-state';
import type { ProgramSession } from '@programs/program-contract';
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

function scanFinding(...tools: ReturnType<typeof detected>[]): CodebaseScan {
  return {
    program: 'posthog-integration',
    scannedAt: '2026-10-26T09:30:00.000Z',
    scannedDir: '/tmp/app',
    tools,
    complete: true,
  };
}

function finishedRun(
  scan: CodebaseScan,
  overrides: Partial<ProgramSession> = {},
): ProgramSession {
  const session = buildSession({ installDir: '/tmp/app' });
  session.scanConsent = ScanConsent.Granted;
  session.frameworkContext[CODEBASE_SCAN_KEY] = scan;
  session.outroData = { kind: OutroKind.Success, message: 'Done' };
  session.credentials = {
    accessToken: 'token',
    projectApiKey: 'phc_example',
    host: HostResolution.fromApiHost('https://us.posthog.com'),
    projectId: 42,
  };
  return Object.assign(session, overrides);
}

const RESEND = detected('Resend', 'Resend');
const OFFER_ON = { 'wizard-email-provider-offer': 'true' };

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
      OFFER_ON,
    );

    expect(offer).toEqual({
      providers: ['Resend', 'AwsSes'],
      providerName: 'Resend',
      workflowsUrl:
        'https://us.posthog.com/project/42/workflows?source=wizard_cli',
    });
  });

  it.each<[string, (scan: CodebaseScan) => ProgramSession]>([
    ['a CI run', (scan) => finishedRun(scan, { ci: true })],
    ['telemetry is off', (scan) => finishedRun(scan, { noTelemetry: true })],
    [
      'sharing was declined',
      (scan) => finishedRun(scan, { scanConsent: ScanConsent.Declined }),
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
  ])('stays silent when %s', (_case, sessionFor) => {
    expect(
      emailProviderOffer(sessionFor(scanFinding(RESEND)), OFFER_ON),
    ).toBeUndefined();
  });

  it('stays silent when the scan found no email provider', () => {
    expect(
      emailProviderOffer(
        finishedRun(scanFinding(detected('Stripe', 'Stripe'))),
        OFFER_ON,
      ),
    ).toBeUndefined();
  });

  it.each<[string, Record<string, string> | null]>([
    ['the flag is off', { 'wizard-email-provider-offer': 'false' }],
    ['the flag evaluation left the flag out', {}],
    ['no flag evaluation finished', null],
  ])('stays silent when %s', (_case, flags) => {
    expect(
      emailProviderOffer(finishedRun(scanFinding(RESEND)), flags),
    ).toBeUndefined();
  });
});
