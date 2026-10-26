import type { CodebaseScan } from './scan';

const EMAIL_PROVIDER_KINDS: ReadonlySet<string> = new Set([
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
]);

export type EmailProviderPersonProperties = {
  wizard_detected_email_providers: string[];
  wizard_detected_email_provider_at: string;
};

export function emailProviderPersonProperties(
  scan: CodebaseScan,
): EmailProviderPersonProperties | undefined {
  const providers = scan.tools
    .map((tool) => tool.kind)
    .filter((kind) => EMAIL_PROVIDER_KINDS.has(kind));
  if (providers.length === 0) return undefined;
  return {
    wizard_detected_email_providers: providers,
    wizard_detected_email_provider_at: scan.scannedAt,
  };
}
