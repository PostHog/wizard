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
    // Firebase authenticates with a service-account JSON key file, not a
    // pasteable string. The terminal credential prompt only collects
    // single-line text, so there is no safe in-cli path: the file upload lives
    // in the app's new-source form. Deep-link there instead of dead-ending on a
    // credential the CLI cannot accept.
    kind: 'Firebase',
    label: 'Firebase',
    mode: 'deep-link',
    signals: {
      // NOTE: the `firebase` client SDK also covers auth-only projects, which
      // have no Firestore data to import. We accept the false positives — the
      // package is a strong signal for the common case.
      npm: ['firebase-admin', 'firebase'],
      python: ['firebase-admin'],
      envKeys: [/^FIREBASE_/, /^NEXT_PUBLIC_FIREBASE_/],
    },
  },
  {
    kind: 'Neon',
    label: 'Neon',
    mode: 'in-cli',
    signals: {
      npm: ['@neondatabase/serverless'],
      envKeys: [/^NEON_/],
    },
  },
  {
    kind: 'PlanetScaleMySQL',
    label: 'PlanetScale MySQL',
    mode: 'in-cli',
    signals: {
      npm: ['@planetscale/database'],
      envKeys: [/^PLANETSCALE_/],
    },
  },
  {
    kind: 'DynamoDB',
    label: 'DynamoDB',
    mode: 'in-cli',
    signals: {
      npm: ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb'],
      python: ['pynamodb'],
    },
  },
  {
    kind: 'Motherduck',
    label: 'MotherDuck',
    mode: 'in-cli',
    signals: {
      npm: ['@motherduck/wasm-client'],
      envKeys: [/^MOTHERDUCK_/],
    },
  },
  {
    kind: 'Databricks',
    label: 'Databricks',
    mode: 'in-cli',
    signals: {
      npm: ['@databricks/sql'],
      python: ['databricks-sql-connector', 'databricks-sdk'],
      envKeys: [/^DATABRICKS_/],
    },
  },
  {
    kind: 'Singlestore',
    label: 'SingleStore',
    mode: 'in-cli',
    signals: {
      python: ['singlestoredb'],
      envKeys: [/^SINGLESTORE_/],
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

  // ============================================================
  // Additional released source types (see PostHog data-warehouse
  // source catalog). Detected by SDK package or .env key convention.
  // ============================================================
  // ---- LLM / AI ----
  {
    kind: 'OpenAI',
    label: 'OpenAI',
    mode: 'in-cli',
    signals: {
      npm: ['openai'],
      python: ['openai'],
      envKeys: [/^OPENAI_/],
    },
  },
  {
    kind: 'Anthropic',
    label: 'Anthropic',
    mode: 'in-cli',
    signals: {
      npm: ['@anthropic-ai/sdk'],
      python: ['anthropic'],
      envKeys: [/^ANTHROPIC_/],
    },
  },
  {
    kind: 'Cohere',
    label: 'Cohere',
    mode: 'in-cli',
    signals: {
      npm: ['cohere-ai'],
      python: ['cohere'],
      envKeys: [/^COHERE_/],
    },
  },
  {
    kind: 'MistralAI',
    label: 'Mistral AI',
    mode: 'in-cli',
    signals: {
      npm: ['@mistralai/mistralai'],
      python: ['mistralai'],
      envKeys: [/^MISTRAL_/],
    },
  },
  {
    kind: 'Groq',
    label: 'Groq',
    mode: 'in-cli',
    signals: {
      npm: ['groq-sdk'],
      python: ['groq'],
      envKeys: [/^GROQ_/],
    },
  },
  {
    kind: 'TogetherAI',
    label: 'Together AI',
    mode: 'in-cli',
    signals: {
      npm: ['together-ai'],
      python: ['together'],
      envKeys: [/^TOGETHER_/],
    },
  },
  {
    kind: 'FireworksAI',
    label: 'Fireworks AI',
    mode: 'in-cli',
    signals: {
      python: ['fireworks-ai'],
      envKeys: [/^FIREWORKS_/],
    },
  },
  {
    kind: 'Replicate',
    label: 'Replicate',
    mode: 'in-cli',
    signals: {
      npm: ['replicate'],
      python: ['replicate'],
      envKeys: [/^REPLICATE_/],
    },
  },
  {
    kind: 'HuggingFace',
    label: 'Hugging Face',
    mode: 'in-cli',
    signals: {
      npm: ['@huggingface/inference'],
      python: ['huggingface-hub'],
      envKeys: [/^HUGGINGFACE_/, /^HF_TOKEN$/],
    },
  },
  {
    kind: 'ElevenLabs',
    label: 'ElevenLabs',
    mode: 'in-cli',
    signals: {
      npm: ['@elevenlabs/elevenlabs-js', 'elevenlabs'],
      python: ['elevenlabs'],
      envKeys: [/^ELEVENLABS_/, /^ELEVEN_LABS_/],
    },
  },
  {
    kind: 'Deepgram',
    label: 'Deepgram',
    mode: 'in-cli',
    signals: {
      npm: ['@deepgram/sdk'],
      python: ['deepgram-sdk'],
      envKeys: [/^DEEPGRAM_/],
    },
  },
  {
    kind: 'AssemblyAI',
    label: 'AssemblyAI',
    mode: 'in-cli',
    signals: {
      npm: ['assemblyai'],
      python: ['assemblyai'],
      envKeys: [/^ASSEMBLYAI_/],
    },
  },
  {
    kind: 'Langfuse',
    label: 'Langfuse',
    mode: 'in-cli',
    signals: {
      npm: ['langfuse'],
      python: ['langfuse'],
      envKeys: [/^LANGFUSE_/],
    },
  },
  {
    kind: 'LangSmith',
    label: 'LangSmith',
    mode: 'in-cli',
    signals: {
      npm: ['langsmith'],
      python: ['langsmith'],
      envKeys: [/^LANGSMITH_/, /^LANGCHAIN_API_KEY$/],
    },
  },
  {
    kind: 'Firecrawl',
    label: 'Firecrawl',
    mode: 'in-cli',
    signals: {
      npm: ['@mendable/firecrawl-js'],
      python: ['firecrawl-py'],
      envKeys: [/^FIRECRAWL_/],
    },
  },
  {
    kind: 'Mem0',
    label: 'Mem0',
    mode: 'in-cli',
    signals: {
      npm: ['mem0ai'],
      python: ['mem0ai'],
      envKeys: [/^MEM0_/],
    },
  },
  {
    kind: 'Vellum',
    label: 'Vellum',
    mode: 'in-cli',
    signals: {
      npm: ['vellum-ai'],
      python: ['vellum-ai'],
      envKeys: [/^VELLUM_/],
    },
  },
  {
    kind: 'Helicone',
    label: 'Helicone',
    mode: 'in-cli',
    signals: {
      npm: ['@helicone/helpers'],
      envKeys: [/^HELICONE_/],
    },
  },
  {
    kind: 'OpenRouter',
    label: 'OpenRouter',
    mode: 'in-cli',
    signals: {
      npm: ['@openrouter/ai-sdk-provider'],
      envKeys: [/^OPENROUTER_/],
    },
  },
  {
    kind: 'Browserbase',
    label: 'Browserbase',
    mode: 'in-cli',
    signals: {
      npm: ['@browserbasehq/sdk', '@browserbasehq/stagehand'],
      python: ['browserbase'],
      envKeys: [/^BROWSERBASE_/],
    },
  },
  {
    kind: 'E2B',
    label: 'E2B',
    mode: 'in-cli',
    signals: {
      npm: ['e2b', '@e2b/code-interpreter'],
      python: ['e2b', 'e2b-code-interpreter'],
      envKeys: [/^E2B_/],
    },
  },
  {
    kind: 'WeightsAndBiases',
    label: 'Weights & Biases',
    mode: 'in-cli',
    signals: {
      python: ['wandb'],
      envKeys: [/^WANDB_/],
    },
  },
  {
    kind: 'LlamaCloud',
    label: 'LlamaCloud',
    mode: 'in-cli',
    signals: {
      npm: ['llama-cloud-services'],
      python: ['llama-cloud-services'],
      envKeys: [/^LLAMA_CLOUD_/],
    },
  },
  {
    kind: 'Zep',
    label: 'Zep',
    mode: 'in-cli',
    signals: {
      npm: ['@getzep/zep-cloud'],
      python: ['zep-cloud'],
      envKeys: [/^ZEP_API_KEY$/],
    },
  },
  // ---- Payments / billing ----
  {
    kind: 'Paystack',
    label: 'Paystack',
    mode: 'in-cli',
    signals: {
      python: ['paystackapi'],
      envKeys: [/^PAYSTACK_/],
    },
  },
  {
    kind: 'Orb',
    label: 'Orb',
    mode: 'in-cli',
    signals: {
      npm: ['orb-billing'],
      python: ['orb-billing'],
      envKeys: [/^ORB_/],
    },
  },
  {
    kind: 'Lago',
    label: 'Lago',
    mode: 'in-cli',
    signals: {
      npm: ['lago-javascript-client'],
      python: ['lago-python-client'],
      envKeys: [/^LAGO_/],
    },
  },
  {
    kind: 'Zuora',
    label: 'Zuora',
    mode: 'in-cli',
    signals: {
      envKeys: [/^ZUORA_/],
    },
  },
  {
    kind: 'Stigg',
    label: 'Stigg',
    mode: 'in-cli',
    signals: {
      npm: ['@stigg/node-server-sdk'],
      envKeys: [/^STIGG_/],
    },
  },
  {
    kind: 'Ramp',
    label: 'Ramp',
    mode: 'in-cli',
    signals: {
      envKeys: [/^RAMP_/],
    },
  },
  {
    kind: 'Brex',
    label: 'Brex',
    mode: 'in-cli',
    signals: {
      envKeys: [/^BREX_/],
    },
  },
  {
    kind: 'Tremendous',
    label: 'Tremendous',
    mode: 'in-cli',
    signals: {
      envKeys: [/^TREMENDOUS_/],
    },
  },
  {
    kind: 'Maxio',
    label: 'Maxio',
    mode: 'in-cli',
    signals: {
      envKeys: [/^MAXIO_/],
    },
  },
  {
    kind: 'Chargify',
    label: 'Chargify',
    mode: 'in-cli',
    signals: {
      envKeys: [/^CHARGIFY_/],
    },
  },
  {
    kind: 'Invoiced',
    label: 'Invoiced',
    mode: 'in-cli',
    signals: {
      npm: ['invoiced'],
      python: ['invoiced'],
      envKeys: [/^INVOICED_/],
    },
  },
  {
    kind: 'LemonSqueezy',
    label: 'Lemon Squeezy',
    mode: 'in-cli',
    signals: {
      npm: ['@lemonsqueezy/lemonsqueezy.js'],
      envKeys: [/^LEMONSQUEEZY_/, /^LEMON_SQUEEZY_/],
    },
  },
  {
    kind: 'Razorpay',
    label: 'Razorpay',
    mode: 'in-cli',
    signals: {
      npm: ['razorpay'],
      python: ['razorpay'],
      ruby: ['razorpay'],
      envKeys: [/^RAZORPAY_/],
    },
  },
  {
    kind: 'Adyen',
    label: 'Adyen',
    mode: 'in-cli',
    signals: {
      npm: ['@adyen/api-library'],
      python: ['adyen'],
      envKeys: [/^ADYEN_/],
    },
  },
  {
    kind: 'ChartMogul',
    label: 'ChartMogul',
    mode: 'in-cli',
    signals: {
      npm: ['chartmogul-node'],
      python: ['chartmogul'],
      envKeys: [/^CHARTMOGUL_/],
    },
  },
  {
    kind: 'Airwallex',
    label: 'Airwallex',
    mode: 'in-cli',
    signals: {
      npm: ['airwallex-payment-elements'],
      envKeys: [/^AIRWALLEX_/],
    },
  },
  {
    kind: 'Flutterwave',
    label: 'Flutterwave',
    mode: 'in-cli',
    signals: {
      npm: ['flutterwave-node-v3'],
      python: ['flutterwave'],
      envKeys: [/^FLUTTERWAVE_/, /^FLW_(PUBLIC|SECRET)_KEY$/],
    },
  },
  {
    kind: 'DodoPayments',
    label: 'Dodo Payments',
    mode: 'in-cli',
    signals: {
      npm: ['dodopayments'],
      python: ['dodopayments'],
      envKeys: [/^DODO_PAYMENTS_/],
    },
  },
  {
    kind: 'Whop',
    label: 'Whop',
    mode: 'in-cli',
    signals: {
      npm: ['@whop/api', '@whop-apps/sdk'],
      envKeys: [/^WHOP_/],
    },
  },
  // ---- Email / marketing ----
  {
    kind: 'SparkPost',
    label: 'SparkPost',
    mode: 'in-cli',
    signals: {
      npm: ['sparkpost'],
      python: ['sparkpost'],
      envKeys: [/^SPARKPOST_/],
    },
  },
  {
    kind: 'MailerSend',
    label: 'MailerSend',
    mode: 'in-cli',
    signals: {
      npm: ['mailersend'],
      python: ['mailersend'],
      envKeys: [/^MAILERSEND_/],
    },
  },
  {
    kind: 'Iterable',
    label: 'Iterable',
    mode: 'in-cli',
    signals: {
      envKeys: [/^ITERABLE_/],
    },
  },
  {
    kind: 'ConvertKit',
    label: 'ConvertKit',
    mode: 'in-cli',
    signals: {
      envKeys: [/^CONVERTKIT_/],
    },
  },
  {
    kind: 'Drip',
    label: 'Drip',
    mode: 'in-cli',
    signals: {
      npm: ['drip-nodejs'],
      envKeys: [/^DRIP_/],
    },
  },
  {
    kind: 'Omnisend',
    label: 'Omnisend',
    mode: 'in-cli',
    signals: {
      envKeys: [/^OMNISEND_/],
    },
  },
  {
    kind: 'EmailOctopus',
    label: 'EmailOctopus',
    mode: 'in-cli',
    signals: {
      envKeys: [/^EMAILOCTOPUS_/, /^EMAIL_OCTOPUS_/],
    },
  },
  {
    kind: 'Elasticemail',
    label: 'Elastic Email',
    mode: 'in-cli',
    signals: {
      envKeys: [/^ELASTICEMAIL_/, /^ELASTIC_EMAIL_/],
    },
  },
  {
    kind: 'CampaignMonitor',
    label: 'Campaign Monitor',
    mode: 'in-cli',
    signals: {
      npm: ['createsend-node'],
      envKeys: [/^CAMPAIGN_MONITOR_/, /^CREATESEND_/],
    },
  },
  {
    kind: 'Lemlist',
    label: 'Lemlist',
    mode: 'in-cli',
    signals: {
      envKeys: [/^LEMLIST_/],
    },
  },
  {
    kind: 'Loops',
    label: 'Loops',
    mode: 'in-cli',
    signals: {
      npm: ['loops'],
      envKeys: [/^LOOPS_/],
    },
  },
  {
    kind: 'Knock',
    label: 'Knock',
    mode: 'in-cli',
    signals: {
      npm: ['@knocklabs/node', '@knocklabs/client'],
      python: ['knockapi'],
      envKeys: [/^KNOCK_/],
    },
  },
  {
    kind: 'AwsSes',
    label: 'Amazon SES',
    mode: 'in-cli',
    signals: {
      npm: ['@aws-sdk/client-ses', '@aws-sdk/client-sesv2'],
      // A bare /^AWS_/ would fire on every AWS project, so we match only
      // the SES-specific prefix.
      envKeys: [/^AWS_SES_/],
    },
  },
  {
    kind: 'Beehiiv',
    label: 'beehiiv',
    mode: 'in-cli',
    signals: {
      envKeys: [/^BEEHIIV_/],
    },
  },
  {
    kind: 'Mailtrap',
    label: 'Mailtrap',
    mode: 'in-cli',
    signals: {
      npm: ['mailtrap'],
      python: ['mailtrap'],
      envKeys: [/^MAILTRAP_/],
    },
  },
  {
    kind: 'Plunk',
    label: 'Plunk',
    mode: 'in-cli',
    signals: {
      npm: ['@plunk/node'],
      envKeys: [/^PLUNK_/],
    },
  },
  {
    kind: 'Ortto',
    label: 'Ortto',
    mode: 'in-cli',
    signals: {
      envKeys: [/^ORTTO_/],
    },
  },
  {
    kind: 'Postscript',
    label: 'Postscript',
    mode: 'in-cli',
    signals: {
      envKeys: [/^POSTSCRIPT_/],
    },
  },
  {
    kind: 'Marketo',
    label: 'Marketo',
    mode: 'in-cli',
    signals: {
      python: ['marketorestpython'],
      envKeys: [/^MARKETO_/],
    },
  },
  {
    kind: 'Lob',
    label: 'Lob',
    mode: 'in-cli',
    signals: {
      npm: ['lob'],
      python: ['lob'],
      envKeys: [/^LOB_API_KEY$/],
    },
  },
  // ---- Product analytics / CDP ----
  {
    kind: 'Segment',
    label: 'Segment',
    mode: 'in-cli',
    signals: {
      npm: ['@segment/analytics-node', 'analytics-node'],
      python: ['segment-analytics-python', 'analytics-python'],
      envKeys: [/^SEGMENT_/],
    },
  },
  {
    kind: 'Snowplow',
    label: 'Snowplow Analytics',
    mode: 'in-cli',
    signals: {
      npm: ['@snowplow/node-tracker'],
      python: ['snowplow-tracker'],
      envKeys: [/^SNOWPLOW_/],
    },
  },
  {
    kind: 'Matomo',
    label: 'Matomo',
    mode: 'in-cli',
    signals: {
      npm: ['matomo-tracker'],
      envKeys: [/^MATOMO_/],
    },
  },
  {
    kind: 'Plausible',
    label: 'Plausible',
    mode: 'in-cli',
    signals: {
      npm: ['plausible-tracker'],
      envKeys: [/^PLAUSIBLE_/],
    },
  },
  // ---- Feature flags / experimentation ----
  {
    kind: 'ConfigCat',
    label: 'ConfigCat',
    mode: 'in-cli',
    signals: {
      npm: ['configcat-node', 'configcat-js'],
      python: ['configcat-client'],
      envKeys: [/^CONFIGCAT_/],
    },
  },
  {
    kind: 'Flagsmith',
    label: 'Flagsmith',
    mode: 'in-cli',
    signals: {
      npm: ['flagsmith-nodejs', 'flagsmith'],
      python: ['flagsmith'],
      envKeys: [/^FLAGSMITH_/],
    },
  },
  {
    kind: 'Unleash',
    label: 'Unleash',
    mode: 'in-cli',
    signals: {
      npm: ['unleash-client'],
      python: ['unleashclient'],
      envKeys: [/^UNLEASH_/],
    },
  },
  {
    kind: 'SplitIo',
    label: 'Split.io',
    mode: 'in-cli',
    signals: {
      npm: ['@splitsoftware/splitio'],
      python: ['splitio-client'],
      envKeys: [/^SPLITIO_/, /^SPLIT_IO_/],
    },
  },
  // ---- Auth / secrets ----
  {
    kind: 'Stytch',
    label: 'Stytch',
    mode: 'in-cli',
    signals: {
      npm: ['stytch'],
      python: ['stytch'],
      envKeys: [/^STYTCH_/],
    },
  },
  {
    kind: 'Doppler',
    label: 'Doppler',
    mode: 'in-cli',
    signals: {
      npm: ['@dopplerhq/node-sdk'],
      envKeys: [/^DOPPLER_/],
    },
  },
  {
    kind: 'Infisical',
    label: 'Infisical',
    mode: 'in-cli',
    signals: {
      npm: ['@infisical/sdk'],
      python: ['infisicalsdk'],
      envKeys: [/^INFISICAL_/],
    },
  },
  {
    kind: 'OnePassword',
    label: '1Password',
    mode: 'in-cli',
    signals: {
      npm: ['@1password/sdk'],
      python: ['onepassword-sdk'],
      envKeys: [/^ONEPASSWORD_/, /^OP_SERVICE_ACCOUNT_TOKEN$/],
    },
  },
  {
    kind: 'Persona',
    label: 'Persona',
    mode: 'in-cli',
    signals: {
      envKeys: [/^PERSONA_/],
    },
  },
  // ---- Comms / webhooks / voice ----
  {
    kind: 'Svix',
    label: 'Svix',
    mode: 'in-cli',
    signals: {
      npm: ['svix'],
      python: ['svix'],
      envKeys: [/^SVIX_/],
    },
  },
  {
    kind: 'Mux',
    label: 'Mux',
    mode: 'in-cli',
    signals: {
      npm: ['@mux/mux-node'],
      python: ['mux-python'],
      envKeys: [/^MUX_/],
    },
  },
  {
    kind: 'Vapi',
    label: 'Vapi',
    mode: 'in-cli',
    signals: {
      npm: ['@vapi-ai/server-sdk'],
      python: ['vapi-server-sdk'],
      envKeys: [/^VAPI_/],
    },
  },
  {
    kind: 'Aircall',
    label: 'Aircall',
    mode: 'in-cli',
    signals: {
      envKeys: [/^AIRCALL_/],
    },
  },
  {
    kind: 'JustCall',
    label: 'JustCall',
    mode: 'in-cli',
    signals: {
      envKeys: [/^JUSTCALL_/],
    },
  },
  {
    kind: 'Telnyx',
    label: 'Telnyx',
    mode: 'in-cli',
    signals: {
      npm: ['telnyx'],
      python: ['telnyx'],
      envKeys: [/^TELNYX_/],
    },
  },
  {
    kind: 'Plivo',
    label: 'Plivo',
    mode: 'in-cli',
    signals: {
      npm: ['plivo'],
      python: ['plivo'],
      envKeys: [/^PLIVO_/],
    },
  },
  {
    kind: 'Courier',
    label: 'Courier',
    mode: 'in-cli',
    signals: {
      npm: ['@trycourier/courier'],
      python: ['trycourier'],
      // COURIER_ is a generic shipping word, so we match the exact key.
      envKeys: [/^COURIER_AUTH_TOKEN$/],
    },
  },
  // ---- E-commerce / logistics ----
  {
    kind: 'WooCommerce',
    label: 'WooCommerce',
    mode: 'in-cli',
    signals: {
      npm: ['@woocommerce/woocommerce-rest-api'],
      python: ['woocommerce'],
      envKeys: [/^WOOCOMMERCE_/],
    },
  },
  {
    kind: 'Recharge',
    label: 'Recharge',
    mode: 'in-cli',
    signals: {
      envKeys: [/^RECHARGE_/],
    },
  },
  {
    kind: 'Commercetools',
    label: 'commercetools',
    mode: 'in-cli',
    signals: {
      npm: ['@commercetools/platform-sdk'],
      python: ['commercetools'],
      envKeys: [/^CTP_/, /^COMMERCETOOLS_/],
    },
  },
  {
    kind: 'Webflow',
    label: 'Webflow',
    mode: 'in-cli',
    signals: {
      npm: ['webflow-api'],
      envKeys: [/^WEBFLOW_/],
    },
  },
  {
    kind: 'Easypost',
    label: 'EasyPost',
    mode: 'in-cli',
    signals: {
      npm: ['@easypost/api'],
      python: ['easypost'],
      envKeys: [/^EASYPOST_/],
    },
  },
  {
    kind: 'Shippo',
    label: 'Shippo',
    mode: 'in-cli',
    signals: {
      npm: ['shippo'],
      python: ['shippo'],
      envKeys: [/^SHIPPO_/],
    },
  },
  {
    kind: 'ShipStation',
    label: 'ShipStation',
    mode: 'in-cli',
    signals: {
      envKeys: [/^SHIPSTATION_/],
    },
  },
  {
    kind: 'Squarespace',
    label: 'Squarespace',
    mode: 'in-cli',
    signals: {
      envKeys: [/^SQUARESPACE_/],
    },
  },
  {
    kind: 'Printify',
    label: 'Printify',
    mode: 'in-cli',
    signals: {
      envKeys: [/^PRINTIFY_/],
    },
  },
  {
    kind: 'BigCommerce',
    label: 'BigCommerce',
    mode: 'in-cli',
    signals: {
      npm: ['node-bigcommerce'],
      envKeys: [/^BIGCOMMERCE_/],
    },
  },
  // ---- Support / helpdesk ----
  {
    kind: 'Freshdesk',
    label: 'Freshdesk',
    mode: 'in-cli',
    signals: {
      python: ['python-freshdesk'],
      envKeys: [/^FRESHDESK_/],
    },
  },
  {
    kind: 'Front',
    label: 'Front',
    mode: 'in-cli',
    signals: {
      envKeys: [/^FRONTAPP_/, /^FRONT_API_/],
    },
  },
  {
    kind: 'Gorgias',
    label: 'Gorgias',
    mode: 'in-cli',
    signals: {
      envKeys: [/^GORGIAS_/],
    },
  },
  {
    kind: 'Chatwoot',
    label: 'Chatwoot',
    mode: 'in-cli',
    signals: {
      envKeys: [/^CHATWOOT_/],
    },
  },
  {
    kind: 'Kustomer',
    label: 'Kustomer',
    mode: 'in-cli',
    signals: {
      envKeys: [/^KUSTOMER_/],
    },
  },
  {
    kind: 'Plain',
    label: 'Plain',
    mode: 'in-cli',
    signals: {
      npm: ['@team-plain/typescript-sdk'],
      envKeys: [/^PLAIN_/],
    },
  },
  {
    kind: 'Canny',
    label: 'Canny',
    mode: 'in-cli',
    signals: {
      envKeys: [/^CANNY_/],
    },
  },
  {
    kind: 'Pylon',
    label: 'Pylon',
    mode: 'in-cli',
    signals: {
      envKeys: [/^PYLON_/],
    },
  },
  // ---- Dev / infra / observability ----
  {
    kind: 'GitLab',
    label: 'GitLab',
    mode: 'in-cli',
    signals: {
      npm: ['@gitbeaker/rest'],
      python: ['python-gitlab'],
      ruby: ['gitlab'],
      envKeys: [/^GITLAB_/],
    },
  },
  {
    kind: 'Bitbucket',
    label: 'Atlassian Bitbucket Cloud',
    mode: 'in-cli',
    signals: {
      npm: ['bitbucket'],
      envKeys: [/^BITBUCKET_/],
    },
  },
  {
    kind: 'Gitea',
    label: 'Gitea',
    mode: 'in-cli',
    signals: {
      npm: ['gitea-js'],
      envKeys: [/^GITEA_/],
    },
  },
  {
    kind: 'Datadog',
    label: 'Datadog',
    mode: 'in-cli',
    signals: {
      npm: ['@datadog/datadog-api-client', 'dd-trace'],
      python: ['datadog', 'datadog-api-client'],
      ruby: ['dogapi'],
      envKeys: [/^DATADOG_/, /^DD_API_KEY$/, /^DD_APP_KEY$/],
    },
  },
  {
    kind: 'NewRelic',
    label: 'New Relic',
    mode: 'in-cli',
    signals: {
      npm: ['newrelic'],
      python: ['newrelic'],
      ruby: ['newrelic_rpm'],
      envKeys: [/^NEW_RELIC_/, /^NEWRELIC_/],
    },
  },
  {
    kind: 'Cloudflare',
    label: 'Cloudflare',
    mode: 'in-cli',
    signals: {
      npm: ['cloudflare'],
      python: ['cloudflare'],
      envKeys: [/^CLOUDFLARE_/, /^CF_API_TOKEN$/],
    },
  },
  {
    kind: 'Elasticsearch',
    label: 'Elasticsearch',
    mode: 'in-cli',
    signals: {
      npm: ['@elastic/elasticsearch'],
      python: ['elasticsearch'],
      ruby: ['elasticsearch'],
      envKeys: [/^ELASTICSEARCH_/],
    },
  },
  {
    kind: 'Snyk',
    label: 'Snyk',
    mode: 'in-cli',
    signals: {
      npm: ['snyk'],
      python: ['pysnyk'],
      envKeys: [/^SNYK_/],
    },
  },
  {
    kind: 'PagerDuty',
    label: 'PagerDuty',
    mode: 'in-cli',
    signals: {
      npm: ['@pagerduty/pdjs'],
      python: ['pdpyras'],
      envKeys: [/^PAGERDUTY_/, /^PD_API_KEY$/],
    },
  },
  {
    kind: 'Opsgenie',
    label: 'Opsgenie',
    mode: 'in-cli',
    signals: {
      envKeys: [/^OPSGENIE_/],
    },
  },
  {
    kind: 'IncidentIo',
    label: 'incident.io',
    mode: 'in-cli',
    signals: {
      envKeys: [/^INCIDENT_IO_/, /^INCIDENTIO_/],
    },
  },
  {
    kind: 'Bugsnag',
    label: 'Bugsnag',
    mode: 'in-cli',
    signals: {
      npm: ['@bugsnag/js'],
      python: ['bugsnag'],
      ruby: ['bugsnag'],
      envKeys: [/^BUGSNAG_/],
    },
  },
  {
    kind: 'Honeybadger',
    label: 'Honeybadger',
    mode: 'in-cli',
    signals: {
      npm: ['@honeybadger-io/js'],
      python: ['honeybadger'],
      ruby: ['honeybadger'],
      envKeys: [/^HONEYBADGER_/],
    },
  },
  {
    kind: 'Raygun',
    label: 'Raygun',
    mode: 'in-cli',
    signals: {
      npm: ['raygun'],
      python: ['raygun4py'],
      ruby: ['raygun4ruby'],
      envKeys: [/^RAYGUN_/],
    },
  },
  {
    kind: 'CircleCI',
    label: 'CircleCI',
    mode: 'in-cli',
    signals: {
      envKeys: [/^CIRCLECI_/, /^CIRCLE_TOKEN$/],
    },
  },
  {
    kind: 'Upstash',
    label: 'Upstash',
    mode: 'in-cli',
    signals: {
      npm: ['@upstash/redis'],
      python: ['upstash-redis'],
      envKeys: [/^UPSTASH_/],
    },
  },
  {
    kind: 'Vercel',
    label: 'Vercel',
    mode: 'in-cli',
    signals: {
      npm: ['@vercel/sdk'],
      envKeys: [/^VERCEL_API_TOKEN$/],
    },
  },
  {
    kind: 'Algolia',
    label: 'Algolia',
    mode: 'in-cli',
    signals: {
      npm: ['algoliasearch'],
      python: ['algoliasearch'],
      ruby: ['algolia'],
      envKeys: [/^ALGOLIA_/],
    },
  },
  {
    kind: 'Inngest',
    label: 'Inngest',
    mode: 'in-cli',
    signals: {
      npm: ['inngest'],
      python: ['inngest'],
      envKeys: [/^INNGEST_/],
    },
  },
  {
    kind: 'TriggerDev',
    label: 'Trigger.dev',
    mode: 'in-cli',
    signals: {
      npm: ['@trigger.dev/sdk'],
      // TRIGGER_ alone is a common app-domain prefix, so we match only the
      // three keys Trigger.dev actually documents.
      envKeys: [/^TRIGGER_(SECRET_KEY|API_KEY|PROJECT_ID)$/],
    },
  },
  {
    kind: 'Ably',
    label: 'Ably',
    mode: 'in-cli',
    signals: {
      npm: ['ably'],
      python: ['ably'],
      envKeys: [/^ABLY_/],
    },
  },
  {
    kind: 'Netlify',
    label: 'Netlify',
    mode: 'in-cli',
    signals: {
      npm: ['@netlify/functions'],
      envKeys: [/^NETLIFY_/],
    },
  },
  {
    kind: 'Railway',
    label: 'Railway',
    mode: 'in-cli',
    signals: {
      envKeys: [/^RAILWAY_/],
    },
  },
  {
    kind: 'Render',
    label: 'Render',
    mode: 'in-cli',
    signals: {
      // RENDER_ is a generic word in front-end code — exact key only.
      envKeys: [/^RENDER_API_KEY$/],
    },
  },
  {
    kind: 'FlyIo',
    label: 'Fly.io',
    mode: 'in-cli',
    signals: {
      // `fly.toml` is not one of the manifests we read, so env keys are the
      // only signal available.
      envKeys: [/^FLY_API_TOKEN$/, /^FLY_APP_NAME$/],
    },
  },
  {
    kind: 'Heroku',
    label: 'Heroku',
    mode: 'in-cli',
    signals: {
      envKeys: [/^HEROKU_/],
    },
  },
  {
    kind: 'DigitalOcean',
    label: 'DigitalOcean',
    mode: 'in-cli',
    signals: {
      // DO_ is too short to be safe, so we match the full product name.
      envKeys: [/^DIGITALOCEAN_/],
    },
  },
  {
    kind: 'Grafana',
    label: 'Grafana',
    mode: 'in-cli',
    signals: {
      python: ['grafana-client'],
      envKeys: [/^GRAFANA_/],
    },
  },
  {
    kind: 'BetterStack',
    label: 'Better Stack',
    mode: 'in-cli',
    signals: {
      // Logtail is Better Stack's log product — same account, same source.
      npm: ['@logtail/node', '@logtail/js'],
      envKeys: [/^BETTERSTACK_/, /^BETTER_STACK_/, /^LOGTAIL_/],
    },
  },
  {
    kind: 'Honeycomb',
    label: 'Honeycomb',
    mode: 'in-cli',
    signals: {
      npm: ['@honeycombio/opentelemetry-node', 'honeycomb-beeline'],
      python: ['honeycomb-beeline', 'libhoney'],
      envKeys: [/^HONEYCOMB_/],
    },
  },
  {
    kind: 'Descope',
    label: 'Descope',
    mode: 'in-cli',
    signals: {
      npm: ['@descope/node-sdk', '@descope/nextjs-sdk', '@descope/react-sdk'],
      python: ['descope'],
      envKeys: [/^DESCOPE_/],
    },
  },
  {
    kind: 'FusionAuth',
    label: 'FusionAuth',
    mode: 'in-cli',
    signals: {
      npm: ['@fusionauth/typescript-client'],
      python: ['fusionauth-client'],
      envKeys: [/^FUSIONAUTH_/, /^FUSION_AUTH_/],
    },
  },
  {
    kind: 'Hookdeck',
    label: 'Hookdeck',
    mode: 'in-cli',
    signals: {
      npm: ['@hookdeck/sdk'],
      envKeys: [/^HOOKDECK_/],
    },
  },
  {
    kind: 'N8n',
    label: 'n8n',
    mode: 'in-cli',
    signals: {
      npm: ['n8n'],
      envKeys: [/^N8N_/],
    },
  },
  {
    kind: 'Dbt',
    label: 'dbt',
    mode: 'in-cli',
    signals: {
      // NOTE: these signals prove the project uses dbt, not that it uses dbt
      // Cloud — the source needs dbt Cloud credentials. Local-only dbt users
      // are a known false positive.
      python: [
        'dbt-core',
        'dbt-snowflake',
        'dbt-postgres',
        'dbt-bigquery',
        'dbt-redshift',
        'dbt-databricks',
      ],
      envKeys: [/^DBT_/],
    },
  },
  {
    kind: 'Fastly',
    label: 'Fastly',
    mode: 'in-cli',
    signals: {
      npm: ['fastly'],
      python: ['fastly'],
      envKeys: [/^FASTLY_/],
    },
  },
  {
    kind: 'Bunny',
    label: 'Bunny.net',
    mode: 'in-cli',
    signals: {
      envKeys: [/^BUNNY_/],
    },
  },
  {
    kind: 'Codecov',
    label: 'Codecov',
    mode: 'in-cli',
    signals: {
      npm: ['codecov'],
      envKeys: [/^CODECOV_/],
    },
  },
  {
    kind: 'Sourcegraph',
    label: 'Sourcegraph',
    mode: 'in-cli',
    signals: {
      envKeys: [/^SOURCEGRAPH_/, /^SRC_ACCESS_TOKEN$/],
    },
  },
  {
    kind: 'TemporalIO',
    label: 'Temporal.io',
    mode: 'in-cli',
    signals: {
      // NOTE: these signals also match a self-hosted Temporal cluster, but the
      // source wants Temporal Cloud mTLS certificates.
      npm: ['@temporalio/client', '@temporalio/worker'],
      python: ['temporalio'],
      envKeys: [/^TEMPORAL_/],
    },
  },
  {
    kind: 'Hatchet',
    label: 'Hatchet',
    mode: 'in-cli',
    signals: {
      npm: ['@hatchet-dev/typescript-sdk'],
      python: ['hatchet-sdk'],
      envKeys: [/^HATCHET_/],
    },
  },
  // ---- CRM / sales ----
  {
    kind: 'Pipedrive',
    label: 'Pipedrive',
    mode: 'in-cli',
    signals: {
      npm: ['pipedrive'],
      envKeys: [/^PIPEDRIVE_/],
    },
  },
  {
    kind: 'Close',
    label: 'Close',
    mode: 'in-cli',
    signals: {
      python: ['closeio'],
      envKeys: [/^CLOSE_API_KEY$/],
    },
  },
  {
    kind: 'Copper',
    label: 'Copper',
    mode: 'in-cli',
    signals: {
      envKeys: [/^COPPER_/],
    },
  },
  {
    kind: 'Insightly',
    label: 'Insightly',
    mode: 'in-cli',
    signals: {
      envKeys: [/^INSIGHTLY_/],
    },
  },
  {
    kind: 'Salesflare',
    label: 'Salesflare',
    mode: 'in-cli',
    signals: {
      envKeys: [/^SALESFLARE_/],
    },
  },
  {
    kind: 'SalesLoft',
    label: 'Salesloft',
    mode: 'in-cli',
    signals: {
      envKeys: [/^SALESLOFT_/],
    },
  },
  {
    kind: 'Attio',
    label: 'Attio',
    mode: 'in-cli',
    signals: {
      npm: ['attio'],
      envKeys: [/^ATTIO_/],
    },
  },
  {
    kind: 'ActiveCampaign',
    label: 'ActiveCampaign',
    mode: 'in-cli',
    signals: {
      envKeys: [/^ACTIVECAMPAIGN_/, /^ACTIVE_CAMPAIGN_/],
    },
  },
  {
    kind: 'Vitally',
    label: 'Vitally',
    mode: 'in-cli',
    signals: {
      envKeys: [/^VITALLY_/],
    },
  },
  {
    kind: 'Docusign',
    label: 'DocuSign',
    mode: 'in-cli',
    signals: {
      npm: ['docusign-esign'],
      python: ['docusign-esign'],
      envKeys: [/^DOCUSIGN_/],
    },
  },
  {
    kind: 'PandaDoc',
    label: 'PandaDoc',
    mode: 'in-cli',
    signals: {
      envKeys: [/^PANDADOC_/],
    },
  },
  {
    kind: 'Gong',
    label: 'Gong',
    mode: 'in-cli',
    signals: {
      envKeys: [/^GONG_/],
    },
  },
  // ---- PM / productivity ----
  {
    kind: 'Asana',
    label: 'Asana',
    mode: 'in-cli',
    signals: {
      npm: ['asana'],
      python: ['asana'],
      envKeys: [/^ASANA_/],
    },
  },
  {
    kind: 'Trello',
    label: 'Trello',
    mode: 'in-cli',
    signals: {
      npm: ['trello'],
      envKeys: [/^TRELLO_/],
    },
  },
  {
    kind: 'Todoist',
    label: 'Todoist',
    mode: 'in-cli',
    signals: {
      npm: ['@doist/todoist-api-typescript'],
      python: ['todoist-api-python'],
      envKeys: [/^TODOIST_/],
    },
  },
  {
    kind: 'Monday',
    label: 'monday.com',
    mode: 'in-cli',
    signals: {
      npm: ['@mondaydotcomorg/api'],
      envKeys: [/^MONDAY_/],
    },
  },
  {
    kind: 'ClickUp',
    label: 'ClickUp',
    mode: 'in-cli',
    signals: {
      envKeys: [/^CLICKUP_/],
    },
  },
  {
    kind: 'Height',
    label: 'Height',
    mode: 'in-cli',
    signals: {
      envKeys: [/^HEIGHT_API_KEY$/],
    },
  },
  {
    kind: 'Shortcut',
    label: 'Shortcut',
    mode: 'in-cli',
    signals: {
      npm: ['@shortcut/client'],
      envKeys: [/^SHORTCUT_/],
    },
  },
  {
    kind: 'Jira',
    label: 'Jira',
    mode: 'in-cli',
    signals: {
      npm: ['jira-client'],
      python: ['jira', 'atlassian-python-api'],
      envKeys: [/^JIRA_/],
    },
  },
  {
    kind: 'Confluence',
    label: 'Confluence',
    mode: 'in-cli',
    signals: {
      envKeys: [/^CONFLUENCE_/],
    },
  },
  {
    kind: 'Airtable',
    label: 'Airtable',
    mode: 'in-cli',
    signals: {
      npm: ['airtable'],
      python: ['pyairtable'],
      envKeys: [/^AIRTABLE_/],
    },
  },
  {
    kind: 'Smartsheet',
    label: 'Smartsheet',
    mode: 'in-cli',
    signals: {
      npm: ['smartsheet'],
      python: ['smartsheet-python-sdk'],
      envKeys: [/^SMARTSHEET_/],
    },
  },
  {
    kind: 'Coda',
    label: 'Coda',
    mode: 'in-cli',
    signals: {
      envKeys: [/^CODA_API_/],
    },
  },
  {
    kind: 'Productboard',
    label: 'Productboard',
    mode: 'in-cli',
    signals: {
      envKeys: [/^PRODUCTBOARD_/],
    },
  },
  {
    kind: 'GoogleSheets',
    label: 'Google Sheets',
    mode: 'in-cli',
    signals: {
      npm: ['google-spreadsheet'],
      python: ['gspread'],
      envKeys: [/^GOOGLE_SHEETS_/],
    },
  },
  {
    kind: 'Formbricks',
    label: 'Formbricks',
    mode: 'in-cli',
    signals: {
      npm: ['@formbricks/js'],
      envKeys: [/^FORMBRICKS_/],
    },
  },
  {
    kind: 'Tally',
    label: 'Tally',
    mode: 'in-cli',
    signals: {
      // Tally is also an accounting product, so we match the exact key.
      envKeys: [/^TALLY_API_KEY$/],
    },
  },
  {
    kind: 'Jotform',
    label: 'Jotform',
    mode: 'in-cli',
    signals: {
      python: ['jotform'],
      envKeys: [/^JOTFORM_/],
    },
  },
  {
    kind: 'GitBook',
    label: 'GitBook',
    mode: 'in-cli',
    signals: {
      npm: ['@gitbook/api'],
      envKeys: [/^GITBOOK_/],
    },
  },
  {
    kind: 'Wordpress',
    label: 'WordPress',
    mode: 'in-cli',
    signals: {
      // NOTE: recall is low here. Most WordPress projects are PHP, and
      // `composer.json` is not one of the manifests we read.
      npm: ['wpapi'],
      envKeys: [/^WORDPRESS_/],
    },
  },
  {
    kind: 'Clockify',
    label: 'Clockify',
    mode: 'in-cli',
    signals: {
      envKeys: [/^CLOCKIFY_/],
    },
  },
  // ---- Scheduling / events ----
  {
    kind: 'Calendly',
    label: 'Calendly',
    mode: 'in-cli',
    signals: {
      envKeys: [/^CALENDLY_/],
    },
  },
  {
    kind: 'CalCom',
    label: 'Cal.com',
    mode: 'in-cli',
    signals: {
      envKeys: [/^CALCOM_/, /^CAL_API_KEY$/],
    },
  },
  {
    kind: 'Eventbrite',
    label: 'Eventbrite',
    mode: 'in-cli',
    signals: {
      python: ['eventbrite'],
      envKeys: [/^EVENTBRITE_/],
    },
  },
  // ---- HR / people ----
  {
    kind: 'BambooHR',
    label: 'BambooHR',
    mode: 'in-cli',
    signals: {
      python: ['pybamboohr'],
      envKeys: [/^BAMBOOHR_/, /^BAMBOO_HR_/],
    },
  },
  {
    kind: 'Personio',
    label: 'Personio',
    mode: 'in-cli',
    signals: {
      envKeys: [/^PERSONIO_/],
    },
  },
  {
    kind: 'Rippling',
    label: 'Rippling',
    mode: 'in-cli',
    signals: {
      envKeys: [/^RIPPLING_/],
    },
  },
  {
    kind: 'Greenhouse',
    label: 'Greenhouse',
    mode: 'in-cli',
    signals: {
      envKeys: [/^GREENHOUSE_/],
    },
  },
  {
    kind: 'Ashby',
    label: 'Ashby',
    mode: 'in-cli',
    signals: {
      envKeys: [/^ASHBY_/],
    },
  },
  {
    kind: 'Workable',
    label: 'Workable',
    mode: 'in-cli',
    signals: {
      envKeys: [/^WORKABLE_/],
    },
  },
  // ---- Ads / marketing analytics (OAuth-first -> deep-link) ----
  {
    kind: 'GoogleAds',
    label: 'Google Ads',
    mode: 'deep-link',
    signals: {
      npm: ['google-ads-api'],
      python: ['google-ads'],
      envKeys: [/^GOOGLE_ADS_/],
    },
  },
  {
    kind: 'MetaAds',
    label: 'Meta Ads',
    mode: 'deep-link',
    signals: {
      npm: ['facebook-nodejs-business-sdk'],
      python: ['facebook-business'],
      envKeys: [/^META_ADS_/, /^FACEBOOK_ADS_/],
    },
  },
  {
    kind: 'LinkedinAds',
    label: 'LinkedIn Ads',
    mode: 'deep-link',
    signals: {
      envKeys: [/^LINKEDIN_ADS_/],
    },
  },
  {
    kind: 'TikTokAds',
    label: 'TikTok Ads',
    mode: 'deep-link',
    signals: {
      envKeys: [/^TIKTOK_ADS_/],
    },
  },
  {
    kind: 'RedditAds',
    label: 'Reddit Ads',
    mode: 'deep-link',
    signals: {
      envKeys: [/^REDDIT_ADS_/],
    },
  },
  {
    kind: 'PinterestAds',
    label: 'Pinterest Ads',
    mode: 'deep-link',
    signals: {
      envKeys: [/^PINTEREST_ADS_/],
    },
  },
  {
    kind: 'BingAds',
    label: 'Bing Ads',
    mode: 'deep-link',
    signals: {
      python: ['bingads'],
      envKeys: [/^BING_ADS_/, /^MICROSOFT_ADS_/],
    },
  },
  {
    kind: 'AmazonAds',
    label: 'Amazon Ads',
    mode: 'deep-link',
    signals: {
      envKeys: [/^AMAZON_ADS_/],
    },
  },
  {
    kind: 'GoogleAnalytics',
    label: 'Google Analytics',
    mode: 'deep-link',
    signals: {
      npm: ['react-ga4'],
      python: ['google-analytics-data'],
      envKeys: [/^GOOGLE_ANALYTICS_/, /^GA4_/],
    },
  },
  {
    kind: 'GoogleSearchConsole',
    label: 'Google Search Console',
    mode: 'deep-link',
    signals: {
      envKeys: [/^SEARCH_CONSOLE_/, /^GSC_/],
    },
  },
  {
    kind: 'AppsFlyer',
    label: 'AppsFlyer',
    mode: 'in-cli',
    signals: {
      npm: ['react-native-appsflyer'],
      envKeys: [/^APPSFLYER_/],
    },
  },
  {
    kind: 'Dub',
    label: 'Dub',
    mode: 'in-cli',
    signals: {
      npm: ['dub'],
      python: ['dub'],
      envKeys: [/^DUB_API_KEY$/],
    },
  },
];
