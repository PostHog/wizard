import type { DetectedTool } from '../warehouse-sources/types';
import type { CodebaseScan } from './scan';

const EMAIL_PROVIDER_KINDS = [
  'AwsSes',
  'BigMailer',
  'Brevo',
  'Elasticemail',
  'EmailOctopus',
  'Flexmail',
  'Loops',
  'Mailchimp',
  'MailerLite',
  'MailerSend',
  'Mailgun',
  'Mailjet',
  'Plunk',
  'Postmark',
  'Resend',
  'SendGrid',
  'Shipmail',
  'Smaily',
  'SparkPost',
  'Tinyemail',
] as const;

export type EmailProviderKind = (typeof EMAIL_PROVIDER_KINDS)[number];

export type EmailProvider = DetectedTool & { kind: EmailProviderKind };

const EMAIL_PROVIDER_KIND_SET: ReadonlySet<string> = new Set(
  EMAIL_PROVIDER_KINDS,
);

function isEmailProvider(tool: DetectedTool): tool is EmailProvider {
  return EMAIL_PROVIDER_KIND_SET.has(tool.kind);
}

export type EmailProviderPersonProperties = {
  wizard_detected_email_providers: string[];
  wizard_detected_email_provider_at: string;
};

export function detectedEmailProviders(scan: CodebaseScan): EmailProvider[] {
  return scan.tools.filter(isEmailProvider);
}

export function emailProviderPersonProperties(
  scan: CodebaseScan,
): EmailProviderPersonProperties | undefined {
  const providers = detectedEmailProviders(scan).map((tool) => tool.kind);
  if (providers.length === 0) return undefined;
  return {
    wizard_detected_email_providers: providers,
    wizard_detected_email_provider_at: scan.scannedAt,
  };
}
