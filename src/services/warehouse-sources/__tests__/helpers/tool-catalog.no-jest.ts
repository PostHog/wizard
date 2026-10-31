import type * as Registry from '../../registry';
import type { CatalogTool, ToolCatalog } from '../../types';

/**
 * A small tool catalog for detection tests, so no test downloads the real one.
 * Entries are trimmed to the signals the tests exercise, and do not track the
 * live catalog.
 */
function tool(
  kind: string,
  overrides: Partial<Omit<CatalogTool, 'signals'>> & {
    signals?: Partial<CatalogTool['signals']>;
  } = {},
): CatalogTool {
  const { signals, ...fields } = overrides;
  return {
    kind,
    label: kind,
    warehouse_source_type: kind,
    wizard_setup_mode: 'in-cli',
    superseded_by: [],
    ...fields,
    signals: {
      env_key_patterns: [],
      script_hosts: [],
      packages: {},
      ...signals,
    },
  };
}

export const FIXTURE_CATALOG: ToolCatalog = {
  schema_version: 1,
  tools: [
    tool('Postgres', {
      label: 'PostgreSQL',
      superseded_by: ['Neon', 'Supabase'],
      signals: {
        env_key_patterns: [
          '^DATABASE_URL$',
          '^POSTGRES_',
          '^PG(HOST|DATABASE|USER|PORT)$',
        ],
        packages: {
          npm: ['pg', 'postgres'],
          pypi: ['psycopg2', 'psycopg2-binary'],
          rubygems: ['pg'],
        },
      },
    }),
    tool('Neon', {
      signals: { packages: { npm: ['@neondatabase/serverless'] } },
    }),
    tool('Supabase', {
      signals: { packages: { npm: ['@supabase/supabase-js'] } },
    }),
    tool('MySQL', { signals: { packages: { npm: ['mysql2'] } } }),
    tool('Stripe', {
      signals: {
        env_key_patterns: ['^STRIPE_(SECRET|API)_KEY$'],
        packages: {
          npm: ['stripe'],
          pypi: ['stripe'],
          go: ['github.com/stripe/stripe-go'],
          rubygems: ['stripe'],
        },
      },
    }),
    tool('Salesforce', {
      wizard_setup_mode: 'deep-link',
      signals: { packages: { npm: ['jsforce'] } },
    }),
    tool('OpenAI', {
      signals: {
        env_key_patterns: ['^OPENAI_'],
        packages: { npm: ['openai'] },
      },
    }),
    tool('Mixpanel', {
      signals: {
        packages: { pypi: ['mixpanel'], 'not-an-ecosystem-yet': ['mixpanel'] },
      },
    }),
    tool('Resend', {
      signals: {
        env_key_patterns: ['^RESEND_API_KEY$'],
        packages: { npm: ['resend'] },
      },
    }),
    tool('Sentry', {
      signals: { packages: { npm: ['@sentry/node'] } },
    }),
    tool('Hotjar', {
      warehouse_source_type: null,
      wizard_setup_mode: null,
      signals: {
        script_hosts: ['hotjar.com'],
        packages: { npm: ['@hotjar/browser'] },
      },
    }),
  ],
};

/**
 * The registry module with the download replaced by the fixture, for a
 * `vi.mock` factory in a test that reaches detection through a program.
 * Takes the real module from `importOriginal` because importing it here
 * would load the mock that called this.
 */
export function withFixtureCatalog(actual: typeof Registry): typeof Registry {
  const detectors = actual.toSourceDetectors(FIXTURE_CATALOG);
  return {
    ...actual,
    loadSourceDetectors: vi.fn(() => Promise.resolve(detectors)),
  };
}
