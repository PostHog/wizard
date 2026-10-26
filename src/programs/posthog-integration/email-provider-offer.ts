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
  providers: EmailProviderKind[];
  providerName: string;
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
  | 'frameworkContext'
>;

const MIGRATE_COMMANDS: Readonly<Partial<Record<EmailProviderKind, string>>> =
  {};

function mayAsk(session: OfferSession, flags: WizardFlags): boolean {
  return (
    flags?.[WIZARD_EMAIL_PROVIDER_OFFER_FLAG_KEY] === 'true' &&
    !session.ci &&
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
    providers: [first, ...others].map((tool) => tool.kind),
    providerName: first.label,
    workflowsUrl: `${credentials.host.appHost}/project/${credentials.projectId}/workflows?source=wizard_cli`,
    migrateCommand: MIGRATE_COMMANDS[first.kind],
  };
}

export function emailProviderOfferQuestion(offer: EmailProviderOffer): string {
  return `Your app sends email with ${offer.providerName}. PostHog can send it too, triggered by the events you already track. Want to try it?`;
}

export function emailProviderOfferChoices(
  offer: EmailProviderOffer,
): { label: string; value: EmailProviderOfferAnswer }[] {
  return [
    { label: 'Yes, show me how', value: EmailProviderOfferAnswer.Yes },
    { label: 'Not now', value: EmailProviderOfferAnswer.NotNow },
    {
      label: `No, I'm happy with ${offer.providerName}`,
      value: EmailProviderOfferAnswer.No,
    },
  ];
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
    $set: {
      wizard_email_offer_answer: answer,
      wizard_email_offer_answered_at: new Date().toISOString(),
    },
  });
}
