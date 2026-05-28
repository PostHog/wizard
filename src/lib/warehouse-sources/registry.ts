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
      envKeys: [/^MONGO(DB)?_(URI|URL)$/, /^MONGODB_/],
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
];
