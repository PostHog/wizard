/**
 * Registry of data warehouse source detectors.
 *
 * Each entry maps a codebase footprint to a PostHog source `kind`. The `kind`
 * strings are validated against the MCP `external-data-sources-wizard` tool —
 * keep them in sync with PostHog's released source types.
 *
 * `in-cli` sources are created from the terminal (databases + API-key SaaS).
 * `deep-link` sources have no safe terminal credential path (OAuth) but a
 * codebase footprint worth nudging the user about — we open the app instead.
 */

import type { SourceDetector } from './types.js';

export const SOURCE_DETECTORS: SourceDetector[] = [
  {
    kind: 'Postgres',
    label: 'PostgreSQL',
    mode: 'in-cli',
    signals: {
      npm: ['pg', 'postgres', 'postgres.js', 'knex', 'sequelize'],
      python: ['psycopg', 'psycopg2', 'psycopg2-binary', 'asyncpg'],
      ruby: ['pg'],
      envKeys: [
        // NOTE: DATABASE_URL is ambiguous — MySQL/SQLite projects (Prisma,
        // Rails) use it too. We only read key NAMES, not the scheme, so this
        // is a deliberate precision/recall tradeoff biased toward the most
        // common convention (DATABASE_URL → Postgres).
        /^DATABASE_URL$/,
        /^POSTGRES_/,
        /^PG(HOST|DATABASE|USER|PORT)$/,
      ],
    },
  },
  {
    kind: 'MySQL',
    label: 'MySQL',
    mode: 'in-cli',
    signals: {
      npm: ['mysql', 'mysql2'],
      python: ['pymysql', 'mysqlclient', 'mysql-connector-python'],
      ruby: ['mysql2'],
      envKeys: [/^MYSQL_/],
    },
  },
  {
    kind: 'MongoDB',
    label: 'MongoDB',
    mode: 'in-cli',
    signals: {
      npm: ['mongodb', 'mongoose'],
      python: ['pymongo', 'motor'],
      ruby: ['mongo', 'mongoid'],
      // Matches both MONGO_* and MONGODB_* prefixes (e.g. MONGO_HOST,
      // MONGODB_URI) in one pattern.
      envKeys: [/^MONGO(DB)?_/],
    },
  },
  {
    kind: 'Snowflake',
    label: 'Snowflake',
    mode: 'in-cli',
    signals: {
      npm: ['snowflake-sdk'],
      python: ['snowflake-connector-python', 'snowflake-sqlalchemy'],
      envKeys: [/^SNOWFLAKE_/],
    },
  },
  {
    kind: 'BigQuery',
    label: 'BigQuery',
    mode: 'in-cli',
    signals: {
      npm: ['@google-cloud/bigquery'],
      python: ['google-cloud-bigquery'],
      envKeys: [/^BIGQUERY_/],
    },
  },
  {
    kind: 'Redshift',
    label: 'Redshift',
    mode: 'in-cli',
    signals: {
      npm: ['node-redshift'],
      python: ['redshift-connector'],
      envKeys: [/^REDSHIFT_/],
    },
  },
  {
    kind: 'MSSQL',
    label: 'SQL Server',
    mode: 'in-cli',
    signals: {
      npm: ['mssql', 'tedious'],
      python: ['pyodbc', 'pymssql'],
      envKeys: [/^MSSQL_/],
    },
  },
  {
    kind: 'Supabase',
    label: 'Supabase',
    mode: 'in-cli',
    signals: {
      npm: ['@supabase/supabase-js'],
      python: ['supabase'],
      envKeys: [/^SUPABASE_/],
    },
  },
  {
    kind: 'ClickHouse',
    label: 'ClickHouse',
    mode: 'in-cli',
    signals: {
      npm: ['@clickhouse/client'],
      python: ['clickhouse-connect', 'clickhouse-driver'],
      envKeys: [/^CLICKHOUSE_/],
    },
  },
  {
    kind: 'Convex',
    label: 'Convex',
    mode: 'in-cli',
    signals: {
      npm: ['convex'],
      python: ['convex'],
      envKeys: [/^CONVEX_/, /^NEXT_PUBLIC_CONVEX_URL$/],
    },
  },
  {
    kind: 'Stripe',
    label: 'Stripe',
    mode: 'in-cli',
    signals: {
      npm: ['stripe', '@stripe/stripe-js', '@stripe/react-stripe-js'],
      python: ['stripe'],
      ruby: ['stripe'],
      envKeys: [/^STRIPE_(SECRET|API)_KEY$/],
    },
  },
  {
    kind: 'Clerk',
    label: 'Clerk',
    mode: 'in-cli',
    signals: {
      npm: [
        '@clerk/nextjs',
        '@clerk/clerk-react',
        '@clerk/backend',
        '@clerk/express',
        '@clerk/fastify',
        '@clerk/remix',
      ],
      envKeys: [/^CLERK_SECRET_KEY$/, /^NEXT_PUBLIC_CLERK_/],
    },
  },
  {
    kind: 'Resend',
    label: 'Resend',
    mode: 'in-cli',
    signals: {
      npm: ['resend'],
      python: ['resend'],
      envKeys: [/^RESEND_API_KEY$/],
    },
  },
  {
    kind: 'Shopify',
    label: 'Shopify',
    mode: 'in-cli',
    signals: {
      npm: ['@shopify/shopify-api', 'shopify-api-node'],
      python: ['shopifyapi'],
      envKeys: [/^SHOPIFY_/],
    },
  },
  {
    kind: 'Klaviyo',
    label: 'Klaviyo',
    mode: 'in-cli',
    signals: {
      npm: ['klaviyo-api'],
      python: ['klaviyo-api'],
      envKeys: [/^KLAVIYO_/],
    },
  },
  {
    kind: 'Chargebee',
    label: 'Chargebee',
    mode: 'in-cli',
    signals: {
      npm: ['chargebee'],
      python: ['chargebee'],
      envKeys: [/^CHARGEBEE_/],
    },
  },
  {
    kind: 'Paddle',
    label: 'Paddle',
    mode: 'in-cli',
    signals: {
      npm: ['@paddle/paddle-node-sdk', '@paddle/paddle-js'],
      envKeys: [/^PADDLE_/],
    },
  },
  {
    kind: 'Polar',
    label: 'Polar',
    mode: 'in-cli',
    signals: {
      npm: ['@polar-sh/sdk', '@polar-sh/nextjs'],
      envKeys: [/^POLAR_/],
    },
  },
  {
    kind: 'Mailchimp',
    label: 'Mailchimp',
    mode: 'in-cli',
    signals: {
      npm: ['@mailchimp/mailchimp_marketing'],
      python: ['mailchimp-marketing'],
      envKeys: [/^MAILCHIMP_/],
    },
  },
  {
    kind: 'CustomerIO',
    label: 'Customer.io',
    mode: 'in-cli',
    signals: {
      npm: ['customerio-node'],
      python: ['customerio'],
      envKeys: [/^CUSTOMER_?IO_/],
    },
  },
  {
    kind: 'Typeform',
    label: 'Typeform',
    mode: 'in-cli',
    signals: {
      npm: ['@typeform/api-client'],
      envKeys: [/^TYPEFORM_/],
    },
  },
  {
    kind: 'Sentry',
    label: 'Sentry',
    mode: 'in-cli',
    signals: {
      npm: [
        '@sentry/node',
        '@sentry/browser',
        '@sentry/react',
        '@sentry/nextjs',
      ],
      python: ['sentry-sdk'],
      ruby: ['sentry-ruby'],
    },
  },
  {
    kind: 'Plaid',
    label: 'Plaid',
    mode: 'in-cli',
    signals: {
      npm: ['plaid'],
      python: ['plaid-python', 'plaid'],
      ruby: ['plaid'],
      envKeys: [/^PLAID_/],
    },
  },
  {
    kind: 'Braintree',
    label: 'Braintree',
    mode: 'in-cli',
    signals: {
      npm: ['braintree'],
      python: ['braintree'],
      ruby: ['braintree'],
      envKeys: [/^BRAINTREE_/],
    },
  },
  {
    kind: 'Square',
    label: 'Square',
    mode: 'in-cli',
    signals: {
      npm: ['square'],
      python: ['squareup'],
      ruby: ['square'],
      envKeys: [/^SQUARE_/],
    },
  },
  {
    kind: 'GoCardless',
    label: 'GoCardless',
    mode: 'in-cli',
    signals: {
      npm: ['gocardless-nodejs'],
      python: ['gocardless-pro'],
      ruby: ['gocardless_pro'],
      envKeys: [/^GOCARDLESS_/],
    },
  },
  {
    kind: 'Mollie',
    label: 'Mollie',
    mode: 'in-cli',
    signals: {
      npm: ['@mollie/api-client'],
      python: ['mollie-api-python'],
      envKeys: [/^MOLLIE_/],
    },
  },
  {
    kind: 'CheckoutCom',
    label: 'Checkout.com',
    mode: 'in-cli',
    signals: {
      npm: ['checkout-sdk-node'],
      python: ['checkout-sdk'],
      // Checkout.com's own convention is the CKO_ prefix.
      envKeys: [/^CKO_/, /^CHECKOUT_COM_/],
    },
  },
  {
    kind: 'Recurly',
    label: 'Recurly',
    mode: 'in-cli',
    signals: {
      npm: ['recurly'],
      python: ['recurly'],
      ruby: ['recurly'],
      envKeys: [/^RECURLY_/],
    },
  },
  {
    kind: 'RevenueCat',
    label: 'RevenueCat',
    mode: 'in-cli',
    signals: {
      npm: [
        '@revenuecat/purchases-js',
        'react-native-purchases',
        '@revenuecat/purchases-capacitor',
      ],
      envKeys: [/^REVENUE_?CAT_/],
    },
  },
  {
    kind: 'Twilio',
    label: 'Twilio',
    mode: 'in-cli',
    signals: {
      npm: ['twilio'],
      python: ['twilio'],
      ruby: ['twilio-ruby'],
      envKeys: [/^TWILIO_/],
    },
  },
  {
    kind: 'SendGrid',
    label: 'SendGrid',
    mode: 'in-cli',
    signals: {
      npm: ['@sendgrid/mail', '@sendgrid/client'],
      python: ['sendgrid'],
      ruby: ['sendgrid-ruby'],
      envKeys: [/^SENDGRID_/],
    },
  },
  {
    kind: 'Mailgun',
    label: 'Mailgun',
    mode: 'in-cli',
    signals: {
      npm: ['mailgun.js', 'mailgun-js'],
      python: ['mailgun'],
      ruby: ['mailgun-ruby'],
      envKeys: [/^MAILGUN_/],
    },
  },
  {
    kind: 'Postmark',
    label: 'Postmark',
    mode: 'in-cli',
    signals: {
      npm: ['postmark'],
      python: ['postmarker'],
      ruby: ['postmark'],
      envKeys: [/^POSTMARK_/],
    },
  },
  {
    kind: 'Brevo',
    label: 'Brevo',
    mode: 'in-cli',
    signals: {
      npm: ['@getbrevo/brevo', 'sib-api-v3-sdk'],
      python: ['sib-api-v3-sdk'],
      envKeys: [/^BREVO_/],
    },
  },
  {
    kind: 'MailerLite',
    label: 'MailerLite',
    mode: 'in-cli',
    signals: {
      npm: ['@mailerlite/mailerlite-nodejs'],
      python: ['mailerlite'],
      envKeys: [/^MAILERLITE_/],
    },
  },
  {
    kind: 'Mailjet',
    label: 'Mailjet',
    mode: 'in-cli',
    signals: {
      npm: ['node-mailjet'],
      python: ['mailjet-rest'],
      // Mailjet's documented env convention is MJ_APIKEY_PUBLIC / *_PRIVATE.
      envKeys: [/^MAILJET_/, /^MJ_APIKEY_/],
    },
  },
  {
    kind: 'LaunchDarkly',
    label: 'LaunchDarkly',
    mode: 'in-cli',
    signals: {
      npm: [
        'launchdarkly-node-server-sdk',
        '@launchdarkly/node-server-sdk',
        'launchdarkly-js-client-sdk',
        'launchdarkly-react-client-sdk',
      ],
      python: ['launchdarkly-server-sdk'],
      ruby: ['launchdarkly-server-sdk'],
      envKeys: [/^LAUNCHDARKLY_/, /^LD_SDK_KEY$/],
    },
  },
  {
    kind: 'Optimizely',
    label: 'Optimizely',
    mode: 'in-cli',
    signals: {
      npm: ['@optimizely/optimizely-sdk'],
      python: ['optimizely-sdk'],
      envKeys: [/^OPTIMIZELY_/],
    },
  },
  {
    kind: 'Braze',
    label: 'Braze',
    mode: 'in-cli',
    signals: {
      npm: ['@braze/web-sdk', '@braze/react-native-sdk'],
      python: ['braze-client'],
      envKeys: [/^BRAZE_/],
    },
  },
  {
    kind: 'Rollbar',
    label: 'Rollbar',
    mode: 'in-cli',
    signals: {
      npm: ['rollbar'],
      python: ['rollbar', 'pyrollbar'],
      ruby: ['rollbar'],
      envKeys: [/^ROLLBAR_/],
    },
  },
  {
    kind: 'Okta',
    label: 'Okta',
    mode: 'in-cli',
    signals: {
      npm: ['@okta/okta-sdk-nodejs', '@okta/okta-auth-js', '@okta/okta-react'],
      python: ['okta'],
      envKeys: [/^OKTA_/],
    },
  },
  {
    kind: 'WorkOS',
    label: 'WorkOS',
    mode: 'in-cli',
    signals: {
      npm: ['@workos-inc/node'],
      python: ['workos'],
      envKeys: [/^WORKOS_/],
    },
  },
  {
    kind: 'Notion',
    label: 'Notion',
    mode: 'in-cli',
    signals: {
      npm: ['@notionhq/client'],
      python: ['notion-client'],
      envKeys: [/^NOTION_/],
    },
  },
  {
    kind: 'FullStory',
    label: 'FullStory',
    mode: 'in-cli',
    signals: {
      npm: ['@fullstory/browser', '@fullstory/react-native'],
      envKeys: [/^FULLSTORY_/],
    },
  },
  {
    kind: 'Amplitude',
    label: 'Amplitude',
    mode: 'in-cli',
    signals: {
      npm: [
        '@amplitude/analytics-browser',
        '@amplitude/analytics-node',
        '@amplitude/analytics-react-native',
        'amplitude-js',
      ],
      python: ['amplitude-analytics'],
      envKeys: [/^AMPLITUDE_/],
    },
  },
  {
    kind: 'Mixpanel',
    label: 'Mixpanel',
    mode: 'in-cli',
    signals: {
      npm: ['mixpanel', 'mixpanel-browser'],
      python: ['mixpanel'],
      ruby: ['mixpanel-ruby'],
      envKeys: [/^MIXPANEL_/],
    },
  },
  {
    kind: 'Pendo',
    label: 'Pendo',
    mode: 'in-cli',
    signals: {
      npm: ['@pendo/agent'],
      envKeys: [/^PENDO_/],
    },
  },
  {
    kind: 'Salesforce',
    label: 'Salesforce',
    mode: 'deep-link',
    signals: {
      npm: ['jsforce'],
      python: ['simple-salesforce'],
      envKeys: [/^SALESFORCE_/],
    },
  },
  {
    kind: 'Hubspot',
    label: 'HubSpot',
    mode: 'deep-link',
    signals: {
      npm: ['@hubspot/api-client'],
      python: ['hubspot-api-client'],
      envKeys: [/^HUBSPOT_/],
    },
  },
  {
    kind: 'Zendesk',
    label: 'Zendesk',
    mode: 'deep-link',
    signals: {
      npm: ['node-zendesk'],
      python: ['zenpy'],
      envKeys: [/^ZENDESK_/],
    },
  },
  {
    kind: 'Intercom',
    label: 'Intercom',
    mode: 'deep-link',
    signals: {
      npm: ['intercom-client', '@intercom/messenger-js-sdk'],
      python: ['python-intercom'],
      envKeys: [/^INTERCOM_/],
    },
  },
  {
    kind: 'Linear',
    label: 'Linear',
    mode: 'deep-link',
    signals: {
      npm: ['@linear/sdk'],
      envKeys: [/^LINEAR_API_KEY$/],
    },
  },
  {
    // OAuth-only in PostHog (Slack app integration), so deep-link.
    kind: 'Slack',
    label: 'Slack',
    mode: 'deep-link',
    signals: {
      npm: ['@slack/web-api', '@slack/bolt'],
      python: ['slack-sdk', 'slack-bolt'],
      envKeys: [/^SLACK_(BOT|APP|SIGNING|CLIENT)_/],
    },
  },
  {
    // 'Github' (not 'GitHub') — matches the ExternalDataSourceType value.
    // Default auth is the GitHub App integration (OAuth), so deep-link.
    kind: 'Github',
    label: 'GitHub',
    mode: 'deep-link',
    signals: {
      npm: ['@octokit/rest', '@octokit/core', '@octokit/graphql', 'octokit'],
      python: ['pygithub'],
      ruby: ['octokit'],
    },
  },
];
