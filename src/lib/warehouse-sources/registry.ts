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
    kind: 'Sentry',
    label: 'Sentry',
    mode: 'deep-link',
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
];
