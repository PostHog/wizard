import type { Discovery } from './discover';
import type { DetectedTool } from './tools';

const EMAIL_PROVIDER_KINDS = [
  'AwsSes',
  'Beehiiv',
  'BigMailer',
  'Brevo',
  'CampaignMonitor',
  'ConvertKit',
  'Drip',
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

export function detectedEmailProviders(discovery: Discovery): EmailProvider[] {
  return discovery.tools.tools.filter(isEmailProvider);
}
