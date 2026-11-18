import {
  detectedEmailProviders,
  getCodebaseScan,
  maySendScanResults,
  type EmailProviderKind,
} from '@services/codebase-scan';
import { WIZARD_EMAIL_PROVIDER_OFFER_FLAG_KEY } from '@shared/constants';
import { OutroKind } from '@shared/outro';
import { analytics } from '@utils/analytics';
import type { ProgramSession } from '@programs/program-contract';

export enum EmailProviderOfferAnswer {
  Yes = 'yes',
  NotNow = 'not_now',
  No = 'no',
  Skipped = 'skipped',
}

export type EmailProviderOffer = {
  providers: [EmailProviderKind, ...EmailProviderKind[]];
  workflowsUrl: string;
  projectId: number;
  installDir: string;
  baseUrl?: string;
  migrateCommand?: string;
};

type OfferSession = Pick<
  ProgramSession,
  | 'ci'
  | 'noTelemetry'
  | 'scanConsent'
  | 'outroData'
  | 'credentials'
  | 'apiUser'
  | 'frameworkContext'
  | 'installDir'
  | 'baseUrl'
>;

const MIGRATE_COMMANDS: Readonly<Partial<Record<EmailProviderKind, string>>> =
  {};

function mayAsk(session: OfferSession): boolean {
  return (
    !session.ci &&
    session.apiUser !== null &&
    maySendScanResults(session) &&
    session.outroData?.kind === OutroKind.Success &&
    analytics.getCachedWizardFlags()?.[WIZARD_EMAIL_PROVIDER_OFFER_FLAG_KEY] ===
      'true'
  );
}

export function emailProviderOffer(
  session: OfferSession,
): EmailProviderOffer | undefined {
  const scan = getCodebaseScan(session);
  const credentials = session.credentials;
  if (!scan || !credentials || !mayAsk(session)) return undefined;
  const [first, ...others] = detectedEmailProviders(scan);
  if (!first) return undefined;
  return {
    providers: [first.kind, ...others.map((provider) => provider.kind)],
    workflowsUrl: `${credentials.host.appHost}/project/${credentials.projectId}/workflows?source=wizard_cli`,
    projectId: credentials.projectId,
    installDir: session.installDir,
    baseUrl: session.baseUrl,
    migrateCommand: MIGRATE_COMMANDS[first.kind],
  };
}

export function reportEmailProviderOfferShown(offer: EmailProviderOffer): void {
  analytics.wizardCapture('email provider offer shown', {
    providers: offer.providers,
  });
}

export function reportEmailProviderOfferAnswered(
  offer: EmailProviderOffer,
  answer: EmailProviderOfferAnswer,
): void {
  analytics.wizardCapture('email provider offer answered', {
    providers: offer.providers,
    answer,
  });
}
