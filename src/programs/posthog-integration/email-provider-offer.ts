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

type OfferedProvider = { kind: EmailProviderKind; label: string };

export type EmailProviderOffer = {
  providers: [OfferedProvider, ...OfferedProvider[]];
  workflowsUrl: string;
  migrateCommand?: string;
};

type WizardFlags = Readonly<Record<string, string>> | null;

type OfferSession = Pick<
  ProgramSession,
  | 'ci'
  | 'noTelemetry'
  | 'scanConsent'
  | 'outroData'
  | 'credentials'
  | 'apiUser'
  | 'frameworkContext'
>;

const MIGRATE_COMMANDS: Readonly<Partial<Record<EmailProviderKind, string>>> =
  {};

function offered({ kind, label }: OfferedProvider): OfferedProvider {
  return { kind, label };
}

function mayAsk(session: OfferSession, flags: WizardFlags): boolean {
  return (
    flags?.[WIZARD_EMAIL_PROVIDER_OFFER_FLAG_KEY] === 'true' &&
    !session.ci &&
    session.apiUser !== null &&
    maySendScanResults(session) &&
    session.outroData?.kind === OutroKind.Success
  );
}

export function emailProviderOffer(
  session: OfferSession,
  flags: WizardFlags = analytics.getCachedWizardFlags(),
): EmailProviderOffer | undefined {
  const scan = getCodebaseScan(session);
  const credentials = session.credentials;
  if (!scan || !credentials || !mayAsk(session, flags)) return undefined;
  const [first, ...others] = detectedEmailProviders(scan);
  if (!first) return undefined;
  return {
    providers: [offered(first), ...others.map(offered)],
    workflowsUrl: `${credentials.host.appHost}/project/${credentials.projectId}/workflows?source=wizard_cli`,
    migrateCommand: MIGRATE_COMMANDS[first.kind],
  };
}

function providerKinds(offer: EmailProviderOffer): EmailProviderKind[] {
  return offer.providers.map((provider) => provider.kind);
}

export const EMAIL_PROVIDER_OFFER_QUESTION =
  "PostHog can send this app's transactional emails directly from code, " +
  'with delivery and engagement events next to your product analytics. ' +
  'Want to try it?';

export function emailProviderOfferChoices(): {
  label: string;
  value: EmailProviderOfferAnswer;
}[] {
  return [
    { label: 'Yes, show me how', value: EmailProviderOfferAnswer.Yes },
    { label: 'Not now', value: EmailProviderOfferAnswer.NotNow },
    { label: 'No thanks', value: EmailProviderOfferAnswer.No },
  ];
}

export function reportEmailProviderOfferShown(offer: EmailProviderOffer): void {
  analytics.wizardCapture('email provider offer shown', {
    providers: providerKinds(offer),
  });
}

export function reportEmailProviderOfferAnswered(
  offer: EmailProviderOffer,
  answer: EmailProviderOfferAnswer,
): void {
  analytics.wizardCapture('email provider offer answered', {
    providers: providerKinds(offer),
    answer,
  });
}
