import {
  detectedEmailProviders,
  getDiscovery,
  maySendDiscovery,
  type EmailProviderKind,
} from '@services/project-discovery';
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
  | 'discoveryConsent'
  | 'outroData'
  | 'credentials'
  | 'apiUser'
  | 'frameworkContext'
  | 'installDir'
  | 'baseUrl'
>;

const MIGRATE_COMMANDS: Readonly<Partial<Record<EmailProviderKind, string>>> =
  {};

/** Only a web page can be the link. Parsing drops line breaks and percent-encodes control characters, and clearing the user and password drops credentials, so the link is safe to print. */
function workflowsUrl(appHost: string, projectId: number): string | undefined {
  if (!URL.canParse(appHost)) return undefined;
  const url = new URL(appHost);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  url.username = '';
  url.password = '';
  url.pathname = `${url.pathname.replace(
    /\/+$/,
    '',
  )}/project/${projectId}/workflows`;
  url.search = 'source=wizard_cli';
  url.hash = '';
  return url.href;
}

function mayAsk(session: OfferSession): boolean {
  return (
    !session.ci &&
    session.apiUser !== null &&
    maySendDiscovery(session) &&
    session.outroData?.kind === OutroKind.Success &&
    analytics.getCachedWizardFlags()?.[WIZARD_EMAIL_PROVIDER_OFFER_FLAG_KEY] ===
      'true'
  );
}

export function emailProviderOffer(
  session: OfferSession,
): EmailProviderOffer | undefined {
  const discovery = getDiscovery(session);
  const credentials = session.credentials;
  if (!discovery || !credentials || !mayAsk(session)) return undefined;
  const [first, ...others] = detectedEmailProviders(discovery);
  const link = workflowsUrl(credentials.host.appHost, credentials.projectId);
  if (!first || !link) return undefined;
  return {
    providers: [first.kind, ...others.map((provider) => provider.kind)],
    workflowsUrl: link,
    projectId: credentials.projectId,
    installDir: session.installDir,
    // Host resolution trims it too, so a blank `--base-url` pins nothing.
    baseUrl: session.baseUrl?.trim() || undefined,
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
